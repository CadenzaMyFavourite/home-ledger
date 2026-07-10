use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub category_type: String,
    pub parent_id: Option<String>,
    pub parent_name: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethod {
    pub id: String,
    pub display_name: String,
    pub method_type: String,
    pub institution: Option<String>,
    pub last_four: Option<String>,
    pub default_currency_code: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdMember {
    pub id: String,
    pub display_name: String,
    pub relationship: Option<String>,
    pub avatar_relative_path: Option<String>,
    pub color: Option<String>,
    pub is_default: bool,
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub id: String,
    pub name: String,
    pub address_line: Option<String>,
    pub city: Option<String>,
    pub province: Option<String>,
    pub country_code: Option<String>,
    pub postal_code: Option<String>,
    pub is_favorite: bool,
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionReferenceData {
    pub categories: Vec<Category>,
    pub payment_methods: Vec<PaymentMethod>,
    pub household_members: Vec<HouseholdMember>,
    pub locations: Vec<Location>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveCategoryInput {
    pub id: Option<String>,
    pub name: String,
    pub category_type: String,
    pub parent_id: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_active: bool,
}

impl SaveCategoryInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let name = self.name.trim();
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::validation(
                "name",
                "分类名称必须为 1 到 100 个字符",
            ));
        }
        if !matches!(self.category_type.as_str(), "income" | "expense") {
            return Err(AppError::validation("categoryType", "分类类型无效"));
        }
        if self.id.as_ref().is_some_and(|id| id.trim().is_empty()) {
            return Err(AppError::validation("id", "分类 ID 无效"));
        }
        if self
            .parent_id
            .as_ref()
            .is_some_and(|id| id.trim().is_empty())
        {
            return Err(AppError::validation("parentId", "父分类 ID 无效"));
        }
        if self.id.is_some() && self.id == self.parent_id {
            return Err(AppError::validation("parentId", "分类不能作为自己的父分类"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavePaymentMethodInput {
    pub id: Option<String>,
    pub display_name: String,
    pub method_type: String,
    pub institution: Option<String>,
    pub last_four: Option<String>,
    pub default_currency_code: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_active: bool,
}

impl SavePaymentMethodInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let name = self.display_name.trim();
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::validation(
                "displayName",
                "支付方式名称必须为 1 到 100 个字符",
            ));
        }
        if !matches!(
            self.method_type.as_str(),
            "cash" | "debit_card" | "credit_card" | "chequing" | "savings" | "other"
        ) {
            return Err(AppError::validation("methodType", "支付方式类型无效"));
        }
        if self.last_four.as_ref().is_some_and(|value| {
            value.len() != 4 || !value.chars().all(|character| character.is_ascii_digit())
        }) {
            return Err(AppError::validation("lastFour", "账户尾号只能是四位数字"));
        }
        if self.default_currency_code.len() != 3
            || !self
                .default_currency_code
                .chars()
                .all(|character| character.is_ascii_uppercase())
        {
            return Err(AppError::validation(
                "defaultCurrencyCode",
                "币种必须是三位大写 ISO 代码",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveHouseholdMemberInput {
    pub id: Option<String>,
    pub display_name: String,
    pub relationship: Option<String>,
    pub color: Option<String>,
    pub is_default: bool,
    pub is_active: bool,
}

impl SaveHouseholdMemberInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let name = self.display_name.trim();
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::validation(
                "displayName",
                "成员名称必须为 1 到 100 个字符",
            ));
        }
        if self
            .relationship
            .as_ref()
            .is_some_and(|value| value.trim().len() > 100)
        {
            return Err(AppError::validation(
                "relationship",
                "成员关系不能超过 100 个字符",
            ));
        }
        if self.is_default && !self.is_active {
            return Err(AppError::validation("isActive", "默认成员必须保持启用"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveLocationInput {
    pub id: Option<String>,
    pub name: String,
    pub address_line: Option<String>,
    pub city: Option<String>,
    pub province: Option<String>,
    pub country_code: Option<String>,
    pub postal_code: Option<String>,
    pub is_favorite: bool,
    pub is_active: bool,
}

impl SaveLocationInput {
    pub fn validate(&self) -> Result<(), AppError> {
        let name = self.name.trim();
        if name.is_empty() || name.len() > 160 {
            return Err(AppError::validation(
                "name",
                "地点名称必须为 1 到 160 个字符",
            ));
        }
        if self.country_code.as_ref().is_some_and(|value| {
            value.len() != 2
                || !value
                    .chars()
                    .all(|character| character.is_ascii_uppercase())
        }) {
            return Err(AppError::validation(
                "countryCode",
                "国家代码必须是两位大写字母",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payment_method_rejects_full_account_number() {
        let input = SavePaymentMethodInput {
            id: None,
            display_name: "家庭信用卡".into(),
            method_type: "credit_card".into(),
            institution: Some("示例银行".into()),
            last_four: Some("1234567890123456".into()),
            default_currency_code: "CAD".into(),
            icon: None,
            color: None,
            is_active: true,
        };

        assert!(input.validate().is_err());
    }

    #[test]
    fn category_rejects_self_parent() {
        let input = SaveCategoryInput {
            id: Some("category".into()),
            name: "分类".into(),
            category_type: "expense".into(),
            parent_id: Some("category".into()),
            icon: None,
            color: None,
            is_active: true,
        };

        assert!(input.validate().is_err());
    }
}
