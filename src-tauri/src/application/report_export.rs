use crate::domain::financial_summary::{
    ExportFinancialReportInput, ExportFinancialReportResult, FinancialSummary,
    FinancialSummaryInput, ReportExportTransaction, ReportNoteQueryInput,
};
use crate::error::AppError;
use crate::repositories::financial_summary_repository::FinancialSummaryRepository;
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Formula, Workbook};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub async fn export_report(
    repository: &FinancialSummaryRepository,
    input: &ExportFinancialReportInput,
) -> Result<ExportFinancialReportResult, AppError> {
    input.validate()?;
    let destination = validate_destination(input)?;
    let summary_input = FinancialSummaryInput {
        period_start_date: input.period_start_date.clone(),
        period_end_date_exclusive: input.period_end_date_exclusive.clone(),
        reporting_currency_code: input.reporting_currency_code.clone(),
    };
    let note_input = ReportNoteQueryInput {
        report_type: input.report_type.clone(),
        period_start_date: input.period_start_date.clone(),
        period_end_date_exclusive: input.period_end_date_exclusive.clone(),
    };
    let (summary, transactions, note) = tokio::try_join!(
        repository.get(&summary_input),
        repository.list_export_transactions(&summary_input),
        repository.get_report_note(&note_input),
    )?;
    let note = note.map(|record| record.note).unwrap_or_default();
    let bytes = match input.export_format.as_str() {
        "csv" => build_csv(&transactions),
        "xlsx" => build_xlsx(&summary, &transactions, &note)?,
        _ => unreachable!("validated export format"),
    };
    write_atomic(&destination, &bytes)?;
    Ok(ExportFinancialReportResult {
        destination_path: destination.to_string_lossy().into_owned(),
        export_format: input.export_format.clone(),
        record_count: transactions.len(),
        byte_count: bytes.len(),
    })
}

fn validate_destination(input: &ExportFinancialReportInput) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(&input.destination_path);
    if !path.is_absolute() {
        return Err(AppError::validation(
            "destinationPath",
            "导出路径必须是绝对路径",
        ));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case(&input.export_format) {
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

fn build_csv(transactions: &[ReportExportTransaction]) -> Vec<u8> {
    let mut output = String::from("\u{feff}");
    output.push_str("transaction_date,transaction_type,amount_minor,currency_code,reporting_amount_minor,reporting_currency_code,category,payment_method,household_member,merchant,note,expense_kind\r\n");
    for transaction in transactions {
        let values = [
            transaction.transaction_date.clone(),
            transaction.transaction_type.clone(),
            transaction.amount_minor.to_string(),
            transaction.currency_code.clone(),
            transaction.reporting_amount_minor.to_string(),
            transaction.reporting_currency_code.clone(),
            transaction.category_name.clone().unwrap_or_default(),
            transaction.payment_method_name.clone().unwrap_or_default(),
            transaction
                .household_member_name
                .clone()
                .unwrap_or_default(),
            transaction.merchant.clone().unwrap_or_default(),
            transaction.note.clone().unwrap_or_default(),
            if transaction.transaction_type == "expense" {
                if transaction.is_fixed {
                    "fixed".to_owned()
                } else {
                    "variable".to_owned()
                }
            } else {
                String::new()
            },
        ];
        output.push_str(&values.map(|value| csv_cell(&value)).join(","));
        output.push_str("\r\n");
    }
    output.into_bytes()
}

pub(crate) fn csv_cell(value: &str) -> String {
    let sanitized = if matches!(value.chars().next(), Some('=' | '+' | '-' | '@')) {
        format!("'{value}")
    } else {
        value.to_owned()
    };
    format!("\"{}\"", sanitized.replace('"', "\"\""))
}

fn build_xlsx(
    summary: &FinancialSummary,
    transactions: &[ReportExportTransaction],
    note: &str,
) -> Result<Vec<u8>, AppError> {
    let mut workbook = Workbook::new();
    let title = Format::new()
        .set_bold()
        .set_font_size(18)
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x1F4B3F))
        .set_align(FormatAlign::Center);
    let section = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x2F6B5B))
        .set_border_bottom(FormatBorder::Thin);
    let header = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x2F6B5B))
        .set_border_bottom(FormatBorder::Thin)
        .set_text_wrap();
    let money = Format::new().set_num_format("#,##0.00");
    let integer = Format::new().set_num_format("#,##0");
    let note_format = Format::new()
        .set_text_wrap()
        .set_background_color(Color::RGB(0xF2F7F5))
        .set_align(FormatAlign::Top)
        .set_align(FormatAlign::Left);
    let minor = |value: i64| value as f64 / 100.0;

    {
        let sheet = workbook.add_worksheet();
        sheet
            .set_name("Summary")?
            .set_screen_gridlines(false)
            .set_column_width(0, 26)?
            .set_column_width(1, 18)?
            .set_column_width(2, 18)?;
        sheet.merge_range(0, 0, 0, 2, "HomeLedger Financial Report", &title)?;
        sheet.write_string_with_format(2, 0, "Report period", &section)?;
        sheet.write_string(2, 1, &summary.period_start_date)?;
        sheet.write_string(2, 2, &summary.period_end_date_exclusive)?;
        let transaction_last_row = transactions.len().max(1) + 1;
        let metrics = [
            ("Income", summary.income_minor, "income", ""),
            ("Expenses", summary.expense_minor, "expense", ""),
            (
                "Fixed expenses",
                summary.fixed_expense_minor,
                "expense",
                "fixed",
            ),
            (
                "Variable expenses",
                summary.variable_expense_minor,
                "expense",
                "variable",
            ),
        ];
        for (offset, (label, value, kind, expense_kind)) in metrics.iter().enumerate() {
            let row = 4 + offset as u32;
            sheet.write_string(row, 0, *label)?;
            let formula = if expense_kind.is_empty() {
                format!(
                    "SUMIF('Transactions'!$B$2:$B${transaction_last_row},\"{kind}\",'Transactions'!$E$2:$E${transaction_last_row})"
                )
            } else {
                format!(
                    "SUMIFS('Transactions'!$E$2:$E${transaction_last_row},'Transactions'!$B$2:$B${transaction_last_row},\"expense\",'Transactions'!$L$2:$L${transaction_last_row},\"{expense_kind}\")"
                )
            };
            sheet.write_formula_with_format(
                row,
                1,
                Formula::new(formula).set_result(minor(*value).to_string()),
                &money,
            )?;
            sheet.write_string(row, 2, &summary.reporting_currency_code)?;
        }
        sheet.write_string(8, 0, "Net")?;
        sheet.write_formula_with_format(
            8,
            1,
            Formula::new("B5-B6").set_result(minor(summary.net_minor).to_string()),
            &money,
        )?;
        sheet.write_string(8, 2, &summary.reporting_currency_code)?;
        sheet.write_string(10, 0, "Actual transaction count")?;
        sheet.write_number_with_format(10, 1, summary.actual_transaction_count as f64, &integer)?;
        sheet.write_string(12, 0, "User note")?;
        sheet.merge_range(13, 0, 16, 2, note, &note_format)?;
        sheet.set_row_height(13, 32)?;
        sheet
            .set_print_fit_to_pages(1, 1)
            .set_footer("&CHomeLedger&C&P of &N");
    }

    {
        let sheet = workbook.add_worksheet();
        sheet
            .set_name("Transactions")?
            .set_screen_gridlines(false)
            .set_freeze_panes(1, 0)?;
        let headers = [
            "Date",
            "Type",
            "Original amount",
            "Currency",
            "Reporting amount",
            "Reporting currency",
            "Category",
            "Payment method",
            "Household member",
            "Merchant",
            "Note",
            "Expense kind",
        ];
        for (column, value) in headers.iter().enumerate() {
            sheet.write_string_with_format(0, column as u16, *value, &header)?;
        }
        for (index, transaction) in transactions.iter().enumerate() {
            let row = (index + 1) as u32;
            sheet.write_string(row, 0, &transaction.transaction_date)?;
            sheet.write_string(row, 1, &transaction.transaction_type)?;
            sheet.write_number_with_format(row, 2, minor(transaction.amount_minor), &money)?;
            sheet.write_string(row, 3, &transaction.currency_code)?;
            sheet.write_number_with_format(
                row,
                4,
                minor(transaction.reporting_amount_minor),
                &money,
            )?;
            sheet.write_string(row, 5, &transaction.reporting_currency_code)?;
            sheet.write_string(row, 6, transaction.category_name.as_deref().unwrap_or(""))?;
            sheet.write_string(
                row,
                7,
                transaction.payment_method_name.as_deref().unwrap_or(""),
            )?;
            sheet.write_string(
                row,
                8,
                transaction.household_member_name.as_deref().unwrap_or(""),
            )?;
            sheet.write_string(row, 9, transaction.merchant.as_deref().unwrap_or(""))?;
            sheet.write_string(row, 10, transaction.note.as_deref().unwrap_or(""))?;
            let expense_kind = if transaction.transaction_type == "expense" {
                if transaction.is_fixed {
                    "fixed"
                } else {
                    "variable"
                }
            } else {
                ""
            };
            sheet.write_string(row, 11, expense_kind)?;
        }
        let last_row = transactions.len().max(1) as u32;
        sheet.autofilter(0, 0, last_row, 11)?;
        for (column, width) in [
            18.0, 12.0, 16.0, 12.0, 18.0, 16.0, 20.0, 20.0, 20.0, 24.0, 36.0, 14.0,
        ]
        .into_iter()
        .enumerate()
        {
            sheet.set_column_width(column as u16, width)?;
        }
        sheet
            .set_landscape()
            .set_print_fit_to_pages(1, 0)
            .set_footer("&CHomeLedger&C&P of &N");
    }

    write_named_totals_sheet(
        &mut workbook,
        "Categories",
        "Category",
        &summary.category_totals,
        &header,
        &money,
    )?;
    write_named_totals_sheet(
        &mut workbook,
        "Payment Methods",
        "Payment method",
        &summary.payment_method_totals,
        &header,
        &money,
    )?;
    write_named_totals_sheet(
        &mut workbook,
        "Household Members",
        "Household member",
        &summary.household_member_totals,
        &header,
        &money,
    )?;

    let buffer = workbook
        .save_to_buffer()
        .map_err(|error| AppError::export(format!("Excel 文件生成失败：{error}")))?;
    Ok(buffer)
}

fn write_named_totals_sheet(
    workbook: &mut Workbook,
    sheet_name: &str,
    first_header: &str,
    values: &[crate::domain::financial_summary::NamedFinancialTotal],
    header: &Format,
    money: &Format,
) -> Result<(), AppError> {
    let sheet = workbook.add_worksheet();
    sheet
        .set_name(sheet_name)?
        .set_screen_gridlines(false)
        .set_freeze_panes(1, 0)?
        .set_column_width(0, 30)?
        .set_column_width(1, 20)?;
    sheet.write_string_with_format(0, 0, first_header, header)?;
    sheet.write_string_with_format(0, 1, "Amount", header)?;
    for (index, value) in values.iter().enumerate() {
        let row = (index + 1) as u32;
        sheet.write_string(row, 0, &value.name)?;
        sheet.write_number_with_format(row, 1, value.amount_minor as f64 / 100.0, money)?;
    }
    Ok(())
}

pub(crate) fn write_atomic(destination: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::export("导出路径无效"))?;
    let token = Uuid::now_v7();
    let temporary = parent.join(format!(".home-ledger-{token}.tmp"));
    let backup = parent.join(format!(".home-ledger-{token}.bak"));
    let result = (|| -> Result<(), std::io::Error> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        let had_existing = destination.exists();
        if had_existing {
            fs::rename(destination, &backup)?;
        }
        if let Err(error) = fs::rename(&temporary, destination) {
            if had_existing {
                let _ = fs::rename(&backup, destination);
            }
            return Err(error);
        }
        if had_existing {
            fs::remove_file(&backup)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| AppError::export(format!("无法写入导出文件：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transaction(merchant: &str, note: &str) -> ReportExportTransaction {
        ReportExportTransaction {
            transaction_date: "2026-07-03".into(),
            transaction_type: "expense".into(),
            amount_minor: 12_345,
            currency_code: "CAD".into(),
            reporting_amount_minor: 12_345,
            reporting_currency_code: "CAD".into(),
            category_name: Some("Food".into()),
            payment_method_name: Some("Cash".into()),
            household_member_name: Some("Me".into()),
            merchant: Some(merchant.into()),
            note: Some(note.into()),
            is_fixed: false,
        }
    }

    #[test]
    fn csv_uses_exact_minor_units_and_blocks_formula_injection() {
        let bytes = build_csv(&[transaction("=CMD()", "a, b")]);
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with('\u{feff}'));
        assert!(text.contains("\"12345\""));
        assert!(text.contains("\"'=CMD()\""));
        assert!(text.contains("\"a, b\""));
    }
}
