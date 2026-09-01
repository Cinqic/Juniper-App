use rusqlite::{Connection, OptionalExtension, Result, params, types::Type};
use serde_json::Value;
use std::path::Path;

pub const SCHEMA_VERSION: i64 = 2;

const INITIAL_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistants (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_profiles (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_profiles (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES provider_profiles(id),
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    assistant_id TEXT NOT NULL REFERENCES assistants(id),
    title TEXT NOT NULL,
    private_chat INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    created_at TEXT NOT NULL,
    model_id TEXT,
    provider_id TEXT
);
CREATE TABLE IF NOT EXISTS message_parts (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    part_type TEXT NOT NULL,
    text TEXT,
    payload TEXT
);
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    assistant_id TEXT REFERENCES assistants(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    arguments TEXT NOT NULL,
    status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_results (
    id TEXT PRIMARY KEY,
    tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES (1, datetime('now'));
"#;

const MIGRATION_V2: &str = r#"
ALTER TABLE conversations ADD COLUMN model_profile_id TEXT REFERENCES model_profiles(id);
CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY CHECK(id = 'singleton'),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_state (
    id TEXT PRIMARY KEY CHECK(id = 'singleton'),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"#;

fn migrate(connection: &Connection) -> Result<()> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.execute_batch(INITIAL_SCHEMA)?;
    let version: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if version < 2 {
        connection.execute_batch(MIGRATION_V2)?;
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, datetime('now'))",
            [],
        )?;
    }
    Ok(())
}

fn connection(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path)?;
    migrate(&connection)?;
    Ok(connection)
}

pub fn initialize(path: &Path) -> Result<()> {
    let _ = connection(path)?;
    Ok(())
}

pub fn load_app_data(path: &Path) -> Result<Option<Value>> {
    let connection = connection(path)?;
    connection
        .query_row(
            "SELECT payload FROM app_state WHERE id = 'singleton'",
            [],
            |row| {
                let payload: String = row.get(0)?;
                serde_json::from_str(&payload).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error))
                })
            },
        )
        .optional()
}

pub fn save_app_data(path: &Path, data: &Value) -> Result<()> {
    let connection = connection(path)?;
    let mut persisted = data.clone();
    if let Some(object) = persisted.as_object_mut() {
        if let Some(conversations) = object
            .get_mut("conversations")
            .and_then(Value::as_array_mut)
        {
            conversations
                .retain(|conversation| !conversation["privateChat"].as_bool().unwrap_or(false));
        }
    }
    let payload = serde_json::to_string(&persisted).unwrap_or_else(|_| "{}".into());
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        "INSERT INTO app_state(id, payload, updated_at) VALUES('singleton', ?1, datetime('now')) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
        params![payload],
    )?;
    let settings = persisted.get("settings").cloned().unwrap_or(Value::Null);
    transaction.execute(
        "INSERT INTO app_settings(id, payload, updated_at) VALUES('singleton', ?1, datetime('now')) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
        params![serde_json::to_string(&settings).unwrap_or_else(|_| "{}".into())],
    )?;
    for table in [
        "tool_results",
        "tool_calls",
        "message_parts",
        "messages",
        "conversations",
        "memories",
        "model_profiles",
        "provider_profiles",
        "assistants",
    ] {
        transaction.execute(&format!("DELETE FROM {table}"), [])?;
    }
    for item in persisted
        .get("assistants")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let id = item["id"].as_str().unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        transaction.execute("INSERT INTO assistants(id, schema_version, payload, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5)", params![id, item["schemaVersion"].as_i64().unwrap_or(2), item.to_string(), item["createdAt"].as_str().unwrap_or(""), item["updatedAt"].as_str().unwrap_or("")])?;
    }
    for item in persisted
        .get("providers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let id = item["id"].as_str().unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        transaction.execute("INSERT INTO provider_profiles(id, payload, created_at, updated_at) VALUES(?1, ?2, ?3, ?4)", params![id, item.to_string(), "", ""])?;
    }
    for item in persisted
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let id = item["id"].as_str().unwrap_or_default();
        let provider_id = item["providerId"].as_str().unwrap_or_default();
        if id.is_empty() || provider_id.is_empty() {
            continue;
        }
        transaction.execute("INSERT INTO model_profiles(id, provider_id, payload, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5)", params![id, provider_id, item.to_string(), "", ""])?;
    }
    for item in persisted
        .get("memories")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let id = item["id"].as_str().unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        transaction.execute("INSERT INTO memories(id, assistant_id, content, source, enabled, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![id, item["assistantId"].as_str(), item["content"].as_str().unwrap_or(""), item["source"].as_str().unwrap_or("user"), item["enabled"].as_bool().unwrap_or(true), item["createdAt"].as_str().unwrap_or(""), item["updatedAt"].as_str().unwrap_or("")])?;
    }
    for conversation in persisted
        .get("conversations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let id = conversation["id"].as_str().unwrap_or_default();
        let assistant_id = conversation["assistantId"].as_str().unwrap_or_default();
        if id.is_empty() || assistant_id.is_empty() {
            continue;
        }
        transaction.execute("INSERT INTO conversations(id, assistant_id, title, private_chat, created_at, updated_at, model_profile_id) VALUES(?1, ?2, ?3, 0, ?4, ?5, ?6)", params![id, assistant_id, conversation["title"].as_str().unwrap_or("New conversation"), conversation["createdAt"].as_str().unwrap_or(""), conversation["updatedAt"].as_str().unwrap_or(""), conversation["modelProfileId"].as_str()])?;
        for message in conversation["messages"].as_array().into_iter().flatten() {
            let message_id = message["id"].as_str().unwrap_or_default();
            if message_id.is_empty() {
                continue;
            }
            transaction.execute("INSERT INTO messages(id, conversation_id, role, created_at, model_id, provider_id) VALUES(?1, ?2, ?3, ?4, ?5, ?6)", params![message_id, id, message["role"].as_str().unwrap_or("user"), message["createdAt"].as_str().unwrap_or(""), message["modelId"].as_str(), message["providerId"].as_str()])?;
            for part in message["parts"].as_array().into_iter().flatten() {
                let part_id = part["id"].as_str().unwrap_or_default();
                if part_id.is_empty() {
                    continue;
                }
                transaction.execute("INSERT INTO message_parts(id, message_id, part_type, text, payload) VALUES(?1, ?2, ?3, ?4, ?5)", params![part_id, message_id, part["type"].as_str().unwrap_or("text"), part["text"].as_str(), serde_json::to_string(&part["metadata"]).unwrap_or_else(|_| "null".into())])?;
            }
        }
    }
    transaction.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_creates_schema_and_enables_foreign_keys() -> Result<()> {
        let connection = Connection::open_in_memory()?;
        migrate(&connection)?;
        let version: i64 =
            connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })?;
        let foreign_keys: i64 =
            connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
        assert_eq!(version, SCHEMA_VERSION);
        assert_eq!(foreign_keys, 1);
        assert!(
            connection
                .query_row::<String, _, _>(
                    "SELECT sql FROM sqlite_master WHERE name = 'app_settings'",
                    [],
                    |row| row.get(0)
                )
                .is_ok()
        );
        Ok(())
    }

    #[test]
    fn app_state_round_trips_and_private_chats_are_excluded() -> Result<()> {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is before the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("juniper-storage-test-{suffix}.db"));
        let data = serde_json::json!({
            "assistants": [{
                "id": "assistant-1",
                "schemaVersion": 2,
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:00Z"
            }],
            "providers": [{ "id": "provider-1" }],
            "models": [{ "id": "model-1", "providerId": "provider-1" }],
            "memories": [],
            "conversations": [
                {
                    "id": "chat-saved",
                    "assistantId": "assistant-1",
                    "title": "Saved",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "modelProfileId": "model-1",
                    "messages": []
                },
                {
                    "id": "chat-private",
                    "assistantId": "assistant-1",
                    "title": "Private",
                    "privateChat": true,
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "messages": []
                }
            ],
            "settings": { "telemetry": "off" }
        });
        save_app_data(&path, &data)?;
        let loaded = load_app_data(&path)?.expect("saved state should be present");
        let conversations = loaded["conversations"]
            .as_array()
            .expect("conversations should be an array");
        assert_eq!(conversations.len(), 1);
        assert_eq!(conversations[0]["id"], "chat-saved");
        assert_eq!(conversations[0]["modelProfileId"], "model-1");

        let connection = Connection::open(&path)?;
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM assistants", [], |row| row.get(0))?,
            1
        );
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM conversations", [], |row| row
                    .get(0))?,
            1
        );
        std::fs::remove_file(path).expect("temporary database should be removable");
        Ok(())
    }
}
