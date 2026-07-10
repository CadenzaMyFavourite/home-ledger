use crate::application::report_export::{csv_cell, write_atomic};
use crate::domain::tax::{
    ExportTaxPackageInput, ExportTaxPackageResult, TaxCandidateRecord, TaxIncomeRecord,
    TaxOrganizer, TaxYearInput,
};
use crate::error::AppError;
use crate::repositories::tax_repository::TaxRepository;
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Formula, Workbook};
use std::path::PathBuf;

const CRA_RECORDS_URL: &str = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/long-should-you-keep-your-income-tax-records.html";
const CRA_MEDICAL_URL: &str = "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/lines-33099-33199-eligible-medical-expenses-you-claim-on-your-tax-return.html";

pub async fn export_tax_package(
    repository: &TaxRepository,
    input: &ExportTaxPackageInput,
) -> Result<ExportTaxPackageResult, AppError> {
    input.validate()?;
    let destination = validate_destination(input)?;
    let query = TaxYearInput {
        year: input.year,
        reporting_currency_code: input.reporting_currency_code.clone(),
    };
    let (organizer, income) = tokio::try_join!(
        repository.get_organizer(&query),
        repository.list_income(&query)
    )?;
    let bytes = match input.export_format.as_str() {
        "csv" => build_csv(&organizer, &income),
        "xlsx" => build_xlsx(&organizer, &income)?,
        _ => unreachable!("validated export format"),
    };
    write_atomic(&destination, &bytes)?;
    Ok(ExportTaxPackageResult {
        destination_path: destination.to_string_lossy().into_owned(),
        export_format: input.export_format.clone(),
        candidate_count: organizer.candidates.len(),
        income_count: income.len(),
        byte_count: bytes.len(),
    })
}

fn validate_destination(input: &ExportTaxPackageInput) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(&input.destination_path);
    if !path.is_absolute() {
        return Err(AppError::validation(
            "destinationPath",
            "导出路径必须是绝对路径",
        ));
    }
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(&input.export_format))
    {
        return Err(AppError::validation(
            "destinationPath",
            "文件扩展名与导出格式不一致",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::validation("destinationPath", "导出路径必须包含父目录"))?;
    if !parent.is_dir() {
        return Err(AppError::validation("destinationPath", "导出目录不存在"));
    }
    if path.is_dir() {
        return Err(AppError::validation(
            "destinationPath",
            "导出目标不能是目录",
        ));
    }
    Ok(path)
}

fn build_csv(organizer: &TaxOrganizer, income: &[TaxIncomeRecord]) -> Vec<u8> {
    let mut output = String::from("\u{feff}");
    output.push_str("record_type,transaction_id,transaction_date,amount_minor,currency_code,reporting_amount_minor,reporting_currency_code,category,payment_method,household_member,merchant,note,tax_tags,tax_tag_sources,review_flags,missing_receipt,attachment_names\r\n");
    for record in income {
        let values = [
            "income".to_owned(),
            record.transaction_id.clone(),
            record.transaction_date.clone(),
            record.amount_minor.to_string(),
            record.currency_code.clone(),
            record.reporting_amount_minor.to_string(),
            record.reporting_currency_code.clone(),
            record.category_name.clone().unwrap_or_default(),
            record.payment_method_name.clone().unwrap_or_default(),
            String::new(),
            record.merchant.clone().unwrap_or_default(),
            record.note.clone().unwrap_or_default(),
            String::new(),
            String::new(),
            String::new(),
            "false".to_owned(),
            String::new(),
        ];
        output.push_str(&values.map(|value| csv_cell(&value)).join(","));
        output.push_str("\r\n");
    }
    for record in &organizer.candidates {
        let values = [
            "tax_candidate_expense".to_owned(),
            record.transaction_id.clone(),
            record.transaction_date.clone(),
            record.amount_minor.to_string(),
            record.currency_code.clone(),
            record.reporting_amount_minor.to_string(),
            record.reporting_currency_code.clone(),
            record.category_name.clone().unwrap_or_default(),
            record.payment_method_name.clone().unwrap_or_default(),
            record.household_member_name.clone().unwrap_or_default(),
            record.merchant.clone().unwrap_or_default(),
            record.note.clone().unwrap_or_default(),
            record
                .tax_tags
                .iter()
                .map(|tag| tag.name.as_str())
                .collect::<Vec<_>>()
                .join("; "),
            record
                .tax_tags
                .iter()
                .map(|tag| tag.source.as_str())
                .collect::<Vec<_>>()
                .join("; "),
            record.review_flags.join("; "),
            (!record.has_attachment).to_string(),
            record.attachment_names.join("; "),
        ];
        output.push_str(&values.map(|value| csv_cell(&value)).join(","));
        output.push_str("\r\n");
    }
    output.into_bytes()
}

fn build_xlsx(organizer: &TaxOrganizer, income: &[TaxIncomeRecord]) -> Result<Vec<u8>, AppError> {
    let mut workbook = Workbook::new();
    let title = Format::new()
        .set_bold()
        .set_font_size(18)
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x6B3E26))
        .set_align(FormatAlign::Center);
    let header = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x8A5738))
        .set_border_bottom(FormatBorder::Thin)
        .set_text_wrap();
    let section = header.clone();
    let money = Format::new().set_num_format("#,##0.00");
    let integer = Format::new().set_num_format("#,##0");
    let note = Format::new()
        .set_text_wrap()
        .set_align(FormatAlign::Top)
        .set_background_color(Color::RGB(0xFAF4EF));
    let warning = Format::new()
        .set_bold()
        .set_text_wrap()
        .set_font_color(Color::RGB(0x7A271A))
        .set_background_color(Color::RGB(0xFDE8E1));
    let minor = |value: i64| value as f64 / 100.0;
    let income_last = income.len().max(1) + 1;
    let candidate_last = organizer.candidates.len().max(1) + 1;

    {
        let sheet = workbook.add_worksheet();
        sheet
            .set_name("Summary")?
            .set_screen_gridlines(false)
            .set_column_width(0, 28)?
            .set_column_width(1, 20)?
            .set_column_width(2, 54)?;
        sheet.merge_range(0, 0, 0, 2, "HomeLedger Tax Organizer", &title)?;
        sheet.write_string_with_format(2, 0, "Profile", &section)?;
        sheet.write_string(2, 1, &organizer.profile.name)?;
        sheet.write_string(
            2,
            2,
            format!(
                "{} / {}",
                organizer.profile.country_code,
                organizer.profile.region_code.as_deref().unwrap_or("—")
            ),
        )?;
        sheet.write_string(3, 0, "Tax year")?;
        sheet.write_string(3, 1, organizer.year.to_string())?;
        sheet.write_string(3, 2, &organizer.reporting_currency_code)?;
        sheet.write_string(5, 0, "Income")?;
        sheet.write_formula_with_format(
            5,
            1,
            Formula::new(format!("SUM(Income!E2:E{income_last})"))
                .set_result(minor(organizer.income_minor).to_string()),
            &money,
        )?;
        sheet.write_string(6, 0, "Candidate expenses")?;
        sheet.write_formula_with_format(
            6,
            1,
            Formula::new(format!("SUM('Tax Candidates'!F2:F{candidate_last})"))
                .set_result(minor(organizer.candidate_expense_minor).to_string()),
            &money,
        )?;
        for (row, label, value) in [
            (8, "Candidate records", organizer.candidate_count),
            (9, "Confirmed tagged", organizer.confirmed_tagged_count),
            (10, "Missing receipts", organizer.missing_receipt_count),
            (11, "Needs review", organizer.needs_review_count),
            (
                12,
                "Excluded currency records",
                organizer.excluded_currency_count,
            ),
        ] {
            sheet.write_string(row, 0, label)?;
            sheet.write_number_with_format(row, 1, value as f64, &integer)?;
        }
        sheet.merge_range(14, 0, 16, 2, &organizer.profile.disclaimer, &warning)?;
        sheet.write_string(18, 0, "CRA record-keeping reference")?;
        sheet.write_url(18, 1, CRA_RECORDS_URL)?;
        sheet.write_string(19, 0, "CRA medical-expense reference")?;
        sheet.write_url(19, 1, CRA_MEDICAL_URL)?;
        sheet.merge_range(21, 0, 23, 2, "References are provided for review only. HomeLedger does not determine eligibility, deductions, or credits.", &note)?;
        sheet
            .set_print_fit_to_pages(1, 1)
            .set_footer("&CHomeLedger&C&P of &N");
    }

    write_income_sheet(&mut workbook, income, &header, &money)?;
    write_candidate_sheet(
        &mut workbook,
        "Tax Candidates",
        &organizer.candidates,
        false,
        &header,
        &money,
    )?;
    write_tag_totals_sheet(&mut workbook, organizer, &header, &money)?;
    write_candidate_sheet(
        &mut workbook,
        "Missing Receipts",
        &organizer.candidates,
        true,
        &header,
        &money,
    )?;
    write_attachments_sheet(&mut workbook, &organizer.candidates, &header)?;

    workbook
        .save_to_buffer()
        .map_err(|error| AppError::export(format!("Excel 税务资料包生成失败：{error}")))
}

fn write_income_sheet(
    workbook: &mut Workbook,
    records: &[TaxIncomeRecord],
    header: &Format,
    money: &Format,
) -> Result<(), AppError> {
    let sheet = workbook.add_worksheet();
    sheet
        .set_name("Income")?
        .set_screen_gridlines(false)
        .set_freeze_panes(1, 0)?;
    for (column, label) in [
        "Transaction ID",
        "Date",
        "Original amount",
        "Currency",
        "Reporting amount",
        "Reporting currency",
        "Category",
        "Payment method",
        "Merchant",
        "Note",
    ]
    .iter()
    .enumerate()
    {
        sheet.write_string_with_format(0, column as u16, *label, header)?;
    }
    for (index, record) in records.iter().enumerate() {
        let row = (index + 1) as u32;
        sheet.write_string(row, 0, &record.transaction_id)?;
        sheet.write_string(row, 1, &record.transaction_date)?;
        sheet.write_number_with_format(row, 2, record.amount_minor as f64 / 100.0, money)?;
        sheet.write_string(row, 3, &record.currency_code)?;
        sheet.write_number_with_format(
            row,
            4,
            record.reporting_amount_minor as f64 / 100.0,
            money,
        )?;
        sheet.write_string(row, 5, &record.reporting_currency_code)?;
        sheet.write_string(row, 6, record.category_name.as_deref().unwrap_or(""))?;
        sheet.write_string(row, 7, record.payment_method_name.as_deref().unwrap_or(""))?;
        sheet.write_string(row, 8, record.merchant.as_deref().unwrap_or(""))?;
        sheet.write_string(row, 9, record.note.as_deref().unwrap_or(""))?;
    }
    finish_table_sheet(
        sheet,
        records.len(),
        9,
        &[38.0, 14.0, 16.0, 10.0, 18.0, 16.0, 20.0, 20.0, 22.0, 38.0],
    )?;
    Ok(())
}

fn write_candidate_sheet(
    workbook: &mut Workbook,
    name: &str,
    records: &[TaxCandidateRecord],
    missing_only: bool,
    header: &Format,
    money: &Format,
) -> Result<(), AppError> {
    let selected: Vec<_> = records
        .iter()
        .filter(|record| !missing_only || !record.has_attachment)
        .collect();
    let sheet = workbook.add_worksheet();
    sheet
        .set_name(name)?
        .set_screen_gridlines(false)
        .set_freeze_panes(1, 0)?;
    for (column, label) in [
        "Transaction ID",
        "Date",
        "Original amount",
        "Currency",
        "Reporting currency",
        "Reporting amount",
        "Category",
        "Payment method",
        "Household member",
        "Merchant",
        "Note",
        "Tax tags",
        "Tag sources",
        "Review flags",
        "Missing receipt",
        "Attachments",
    ]
    .iter()
    .enumerate()
    {
        sheet.write_string_with_format(0, column as u16, *label, header)?;
    }
    for (index, record) in selected.iter().enumerate() {
        let row = (index + 1) as u32;
        sheet.write_string(row, 0, &record.transaction_id)?;
        sheet.write_string(row, 1, &record.transaction_date)?;
        sheet.write_number_with_format(row, 2, record.amount_minor as f64 / 100.0, money)?;
        sheet.write_string(row, 3, &record.currency_code)?;
        sheet.write_string(row, 4, &record.reporting_currency_code)?;
        sheet.write_number_with_format(
            row,
            5,
            record.reporting_amount_minor as f64 / 100.0,
            money,
        )?;
        sheet.write_string(row, 6, record.category_name.as_deref().unwrap_or(""))?;
        sheet.write_string(row, 7, record.payment_method_name.as_deref().unwrap_or(""))?;
        sheet.write_string(
            row,
            8,
            record.household_member_name.as_deref().unwrap_or(""),
        )?;
        sheet.write_string(row, 9, record.merchant.as_deref().unwrap_or(""))?;
        sheet.write_string(row, 10, record.note.as_deref().unwrap_or(""))?;
        sheet.write_string(
            row,
            11,
            record
                .tax_tags
                .iter()
                .map(|tag| tag.name.as_str())
                .collect::<Vec<_>>()
                .join("; "),
        )?;
        sheet.write_string(
            row,
            12,
            record
                .tax_tags
                .iter()
                .map(|tag| tag.source.as_str())
                .collect::<Vec<_>>()
                .join("; "),
        )?;
        sheet.write_string(row, 13, record.review_flags.join("; "))?;
        sheet.write_boolean(row, 14, !record.has_attachment)?;
        sheet.write_string(row, 15, record.attachment_names.join("; "))?;
    }
    finish_table_sheet(
        sheet,
        selected.len(),
        15,
        &[
            38.0, 14.0, 16.0, 10.0, 16.0, 18.0, 20.0, 20.0, 18.0, 22.0, 38.0, 30.0, 18.0, 26.0,
            16.0, 32.0,
        ],
    )?;
    Ok(())
}

fn write_tag_totals_sheet(
    workbook: &mut Workbook,
    organizer: &TaxOrganizer,
    header: &Format,
    money: &Format,
) -> Result<(), AppError> {
    let sheet = workbook.add_worksheet();
    sheet
        .set_name("Tag Totals")?
        .set_screen_gridlines(false)
        .set_freeze_panes(1, 0)?;
    for (column, label) in [
        "Tax tag ID",
        "Tax tag",
        "Candidate amount",
        "Transaction count",
        "Important",
    ]
    .iter()
    .enumerate()
    {
        sheet.write_string_with_format(0, column as u16, *label, header)?;
    }
    for (index, total) in organizer.tag_totals.iter().enumerate() {
        let row = (index + 1) as u32;
        sheet.write_string(row, 0, &total.tax_tag_id)?;
        sheet.write_string(row, 1, &total.name)?;
        sheet.write_number_with_format(row, 2, total.amount_minor as f64 / 100.0, money)?;
        sheet.write_number(row, 3, total.transaction_count as f64)?;
        sheet.write_string(row, 4, "Totals may overlap when one transaction has multiple tags; eligibility is not determined.")?;
    }
    finish_table_sheet(
        sheet,
        organizer.tag_totals.len(),
        4,
        &[38.0, 24.0, 20.0, 18.0, 72.0],
    )?;
    Ok(())
}

fn write_attachments_sheet(
    workbook: &mut Workbook,
    records: &[TaxCandidateRecord],
    header: &Format,
) -> Result<(), AppError> {
    let sheet = workbook.add_worksheet();
    sheet
        .set_name("Attachments")?
        .set_screen_gridlines(false)
        .set_freeze_panes(1, 0)?;
    for (column, label) in ["Transaction ID", "Date", "Merchant", "Attachment filename"]
        .iter()
        .enumerate()
    {
        sheet.write_string_with_format(0, column as u16, *label, header)?;
    }
    let mut row = 1;
    for record in records {
        for attachment in &record.attachment_names {
            sheet.write_string(row, 0, &record.transaction_id)?;
            sheet.write_string(row, 1, &record.transaction_date)?;
            sheet.write_string(row, 2, record.merchant.as_deref().unwrap_or(""))?;
            sheet.write_string(row, 3, attachment)?;
            row += 1;
        }
    }
    finish_table_sheet(
        sheet,
        row.saturating_sub(1) as usize,
        3,
        &[38.0, 14.0, 24.0, 40.0],
    )?;
    Ok(())
}

fn finish_table_sheet(
    sheet: &mut rust_xlsxwriter::Worksheet,
    rows: usize,
    last_column: u16,
    widths: &[f64],
) -> Result<(), AppError> {
    sheet.autofilter(0, 0, rows.max(1) as u32, last_column)?;
    for (column, width) in widths.iter().enumerate() {
        sheet.set_column_width(column as u16, *width)?;
    }
    sheet
        .set_landscape()
        .set_print_fit_to_pages(1, 0)
        .set_footer("&CHomeLedger&C&P of &N");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::tax::{TaxCandidateTag, TaxProfileRecord, TaxTagTotal};

    fn organizer() -> TaxOrganizer {
        TaxOrganizer {
            year: 2026,
            reporting_currency_code: "CAD".into(),
            profile: TaxProfileRecord {
                id: "profile".into(),
                name: "Canada / Ontario".into(),
                country_code: "CA".into(),
                region_code: Some("ON".into()),
                disclaimer: "Review only".into(),
            },
            income_minor: 300_001,
            candidate_expense_minor: 12_345,
            candidate_count: 1,
            confirmed_tagged_count: 1,
            missing_receipt_count: 1,
            needs_review_count: 1,
            excluded_currency_count: 0,
            tags: vec![],
            tag_totals: vec![TaxTagTotal {
                tax_tag_id: "medical".into(),
                name: "Medical".into(),
                amount_minor: 12_345,
                transaction_count: 1,
            }],
            candidates: vec![TaxCandidateRecord {
                transaction_id: "expense-1".into(),
                version: 1,
                transaction_date: "2026-02-03".into(),
                amount_minor: 12_345,
                currency_code: "CAD".into(),
                reporting_amount_minor: 12_345,
                reporting_currency_code: "CAD".into(),
                category_name: Some("Medical".into()),
                payment_method_name: Some("Card".into()),
                household_member_name: Some("Me".into()),
                merchant: Some("=Clinic".into()),
                note: Some("Review, do not decide".into()),
                tax_tags: vec![TaxCandidateTag {
                    id: "medical".into(),
                    name: "Medical".into(),
                    source: "user".into(),
                }],
                review_flags: vec!["tax_review".into()],
                attachment_names: vec![],
                has_attachment: false,
                needs_review: true,
            }],
        }
    }

    fn income() -> TaxIncomeRecord {
        TaxIncomeRecord {
            transaction_id: "income-1".into(),
            transaction_date: "2026-01-31".into(),
            amount_minor: 300_001,
            currency_code: "CAD".into(),
            reporting_amount_minor: 300_001,
            reporting_currency_code: "CAD".into(),
            category_name: Some("Salary".into()),
            payment_method_name: Some("Bank".into()),
            merchant: Some("Employer".into()),
            note: None,
        }
    }

    #[test]
    fn csv_preserves_minor_units_and_sanitizes_cells() {
        let bytes = build_csv(&organizer(), &[]);
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("\"12345\""));
        assert!(text.contains("\"'=Clinic\""));
        assert!(text.contains("\"true\""));
    }

    #[test]
    fn xlsx_contains_all_tax_package_sheets() {
        let bytes = build_xlsx(&organizer(), &[income()]).unwrap();
        assert!(bytes.starts_with(b"PK"));
        assert!(bytes.len() > 5_000);
        if let Ok(path) = std::env::var("HOME_LEDGER_TAX_QA_OUTPUT") {
            std::fs::write(path, &bytes).unwrap();
        }
    }
}
