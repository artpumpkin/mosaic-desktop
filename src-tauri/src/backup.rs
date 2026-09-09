use serde_json::Value;
use sqlx::Row;
use std::collections::BTreeMap;

type Tables = BTreeMap<String, Vec<BTreeMap<String, Value>>>;
const TABLES: &[&str] = &[
    "holdings_cache",
    "net_worth_snapshots",
    "fx_rates",
    "debts",
    "incomes",
    "expense_budgets",
    "expenses",
    "eth_wallets",
    "exchange_accounts",
    "cash_holdings",
    "bank_accounts",
    "app_settings",
    "weight_entries",
    "assets",
    "fasting_sessions",
];

async fn replace(pool: &sqlx::SqlitePool, tables: Tables) -> Result<(), String> {
    if tables.is_empty() || tables.keys().any(|t| !TABLES.contains(&t.as_str())) {
        return Err("Unsupported backup tables".into());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // Validate every table and row before any deletion. SQLite constraints
    // remain authoritative; any later failure rolls the transaction back.
    for (table, rows) in &tables {
        if rows.len() > 100_000 {
            return Err("Backup table is too large".into());
        }
        let columns: Vec<String> = sqlx::query(&format!("PRAGMA table_info(\"{table}\")"))
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .iter()
            .map(|r| r.get("name"))
            .collect();
        for row in rows {
            if row.is_empty()
                || row.keys().any(|c| !columns.contains(c))
                || row
                    .values()
                    .any(|v| matches!(v, Value::Object(_) | Value::Array(_)))
            {
                return Err(format!("Invalid backup row in {table}"));
            }
        }
    }
    for table in TABLES {
        if tables.contains_key(*table) {
            sqlx::query(&format!("DELETE FROM \"{table}\""))
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    for table in TABLES.iter().rev() {
        let Some(rows) = tables.get(*table) else {
            continue;
        };
        for row in rows {
            let columns = row
                .keys()
                .map(|c| format!("\"{c}\""))
                .collect::<Vec<_>>()
                .join(",");
            let placeholders = vec!["?"; row.len()].join(",");
            let sql = format!("INSERT INTO \"{table}\" ({columns}) VALUES ({placeholders})");
            let mut query = sqlx::query(&sql);
            for value in row.values() {
                query = match value {
                    Value::Null => query.bind(None::<String>),
                    Value::Bool(v) => query.bind(*v),
                    Value::String(v) => query.bind(v),
                    Value::Number(v) if v.is_i64() => query.bind(v.as_i64()),
                    Value::Number(v) => query.bind(v.as_f64()),
                    _ => return Err("Unsupported value".into()),
                };
            }
            query
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("Import failed in {table}: {e}"))?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_backup(
    state: tauri::State<'_, tauri_plugin_sql::DbInstances>,
    tables: Tables,
) -> Result<(), String> {
    if serde_json::to_vec(&tables)
        .map_err(|e| e.to_string())?
        .len()
        > 16 * 1024 * 1024
    {
        return Err("Backup exceeds 16 MiB".into());
    }
    let instances = state.0.read().await;
    let Some(tauri_plugin_sql::DbPool::Sqlite(pool)) = instances.get("sqlite:finance.db") else {
        return Err("Open the database before importing".into());
    };
    replace(pool, tables).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn failed_import_preserves_original_records() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE bank_accounts (id INTEGER PRIMARY KEY, label TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO bank_accounts VALUES (1, 'Original')")
            .execute(&pool)
            .await
            .unwrap();
        let invalid = serde_json::from_value(serde_json::json!({"bank_accounts":[{"id":2,"label":"New"},{"id":2,"label":"Duplicate"}]})).unwrap();
        assert!(replace(&pool, invalid).await.is_err());
        let original: String = sqlx::query_scalar("SELECT label FROM bank_accounts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(original, "Original");
        let valid = serde_json::from_value(
            serde_json::json!({"bank_accounts":[{"id":3,"label":"Imported"}]}),
        )
        .unwrap();
        replace(&pool, valid).await.unwrap();
        let imported: String = sqlx::query_scalar("SELECT label FROM bank_accounts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(imported, "Imported");
    }
}
