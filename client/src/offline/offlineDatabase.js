import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

const DATABASE_NAME = "cricket_offline";
const connection = new SQLiteConnection(CapacitorSQLite);

let databasePromise;

async function openDatabase() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Offline match storage is available in the installed mobile app.");
  }

  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await connection.createConnection(
        DATABASE_NAME,
        false,
        "no-encryption",
        1,
        false
      );
      await database.open();
      await database.execute(`
        CREATE TABLE IF NOT EXISTS downloaded_matches (
          match_id TEXT PRIMARY KEY NOT NULL,
          match_json TEXT NOT NULL,
          downloaded_at TEXT NOT NULL,
          server_updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS score_outbox (
          action_id TEXT PRIMARY KEY NOT NULL,
          match_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          previous_match_json TEXT,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'synced')),
          created_at TEXT NOT NULL,
          UNIQUE (match_id, sequence),
          FOREIGN KEY (match_id) REFERENCES downloaded_matches(match_id)
            ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS score_outbox_pending
          ON score_outbox(match_id, status, sequence);

        CREATE TABLE IF NOT EXISTS app_settings (
          setting_key TEXT PRIMARY KEY NOT NULL,
          setting_value TEXT NOT NULL
        );
      `);
      const outboxColumns = await database.query("PRAGMA table_info(score_outbox)");
      if (!(outboxColumns.values || []).some((column) => column.name === "previous_match_json")) {
        await database.execute("ALTER TABLE score_outbox ADD COLUMN previous_match_json TEXT");
      }
      return database;
    })().catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }

  return databasePromise;
}

export async function saveDownloadedMatch(match) {
  if (!match?._id) throw new Error("A match ID is required to save an offline match.");
  const database = await openDatabase();
  const id = String(match._id);
  const pending = await database.query(
    "SELECT COUNT(*) AS count FROM score_outbox WHERE match_id = ? AND status = 'pending'",
    [id]
  );
  if (Number(pending.values?.[0]?.count || 0) > 0) {
    throw new Error("Sync this match's pending scores before downloading it again.");
  }

  await database.run(
    `INSERT INTO downloaded_matches (match_id, match_json, downloaded_at, server_updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(match_id) DO UPDATE SET
       match_json = excluded.match_json,
       downloaded_at = excluded.downloaded_at,
       server_updated_at = excluded.server_updated_at`,
    [
      id,
      JSON.stringify(match),
      new Date().toISOString(),
      match.updatedAt || null,
    ]
  );
}

export async function getDownloadedMatch(matchId) {
  const database = await openDatabase();
  const result = await database.query(
    "SELECT match_json FROM downloaded_matches WHERE match_id = ?",
    [String(matchId)]
  );
  const row = result.values?.[0];
  return row ? JSON.parse(row.match_json) : null;
}

export async function getDownloadedMatches() {
  const database = await openDatabase();
  const result = await database.query(
    `SELECT d.match_json, d.downloaded_at,
       (SELECT COUNT(*) FROM score_outbox o
        WHERE o.match_id = d.match_id AND o.status = 'pending') AS pending_count
     FROM downloaded_matches d
     ORDER BY d.downloaded_at DESC`
  );
  return (result.values || []).map((row) => ({
    match: JSON.parse(row.match_json),
    pendingCount: Number(row.pending_count || 0),
  }));
}

export async function saveOfflineAction(matchId, actionId, payload, match, previousMatch) {
  const database = await openDatabase();
  const id = String(matchId);
  await database.executeSet({
    set: [
      {
        statement: `INSERT INTO score_outbox (action_id, match_id, sequence, payload_json, previous_match_json, created_at)
          SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ?
          FROM score_outbox WHERE match_id = ?`,
        values: [actionId, id, JSON.stringify(payload), JSON.stringify(previousMatch), new Date().toISOString(), id],
      },
      {
        statement: "UPDATE downloaded_matches SET match_json = ? WHERE match_id = ?",
        values: [JSON.stringify(match), id],
      },
    ],
    transaction: true,
  });
}

export async function saveOfflineMatchCreation(match, actionId, payload) {
  if (!match?._id) throw new Error("A match ID is required to save an offline match.");
  const database = await openDatabase();
  const id = String(match._id);
  const timestamp = new Date().toISOString();
  await database.executeSet({
    set: [
      {
        statement: `INSERT INTO downloaded_matches (match_id, match_json, downloaded_at, server_updated_at)
          VALUES (?, ?, ?, NULL)`,
        values: [id, JSON.stringify(match), timestamp],
      },
      {
        statement: `INSERT INTO score_outbox (action_id, match_id, sequence, payload_json, previous_match_json, created_at)
          VALUES (?, ?, 1, ?, NULL, ?)`,
        values: [actionId, id, JSON.stringify(payload), timestamp],
      },
    ],
    transaction: true,
  });
}

export async function undoLastOfflineAction(matchId) {
  const database = await openDatabase();
  const id = String(matchId);
  const result = await database.query(
    `SELECT action_id, previous_match_json FROM score_outbox
     WHERE match_id = ? AND status = 'pending'
     ORDER BY sequence DESC LIMIT 1`,
    [id]
  );
  const action = result.values?.[0];
  if (!action) throw new Error("There are no unsynced actions to undo.");
  if (!action.previous_match_json) {
    const payloadResult = await database.query(
      "SELECT payload_json FROM score_outbox WHERE action_id = ?",
      [action.action_id]
    );
    const payload = JSON.parse(payloadResult.values?.[0]?.payload_json || "{}");
    if (!["create_turf_match", "create_tcl_match"].includes(payload.type)) {
      throw new Error("This saved action cannot be undone on this version.");
    }
    await database.executeSet({
      set: [
        {
          statement: "DELETE FROM score_outbox WHERE match_id = ? AND status = 'pending'",
          values: [id],
        },
        {
          statement: "DELETE FROM downloaded_matches WHERE match_id = ?",
          values: [id],
        },
      ],
      transaction: true,
    });
    return null;
  }
  const restoredMatch = JSON.parse(action.previous_match_json);
  await database.executeSet({
    set: [
      {
        statement: "DELETE FROM score_outbox WHERE action_id = ? AND status = 'pending'",
        values: [action.action_id],
      },
      {
        statement: "UPDATE downloaded_matches SET match_json = ? WHERE match_id = ?",
        values: [JSON.stringify(restoredMatch), id],
      },
    ],
    transaction: true,
  });
  return restoredMatch;
}

export async function getAppSetting(key) {
  const database = await openDatabase();
  const result = await database.query(
    "SELECT setting_value FROM app_settings WHERE setting_key = ?",
    [key]
  );
  return result.values?.[0]?.setting_value || "";
}

export async function setAppSetting(key, value) {
  const database = await openDatabase();
  await database.run(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    [key, value]
  );
}

export async function saveOfflineCatalog(catalog) {
  if (!catalog?.downloadedAt) throw new Error("The downloaded app data is missing its timestamp.");
  await setAppSetting("offline_catalog", JSON.stringify(catalog));
  const database = await openDatabase();
  for (const match of catalog.matches || []) {
    if (!match._id) continue;
    await database.run(
      `INSERT INTO downloaded_matches (match_id, match_json, downloaded_at, server_updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         match_json = excluded.match_json,
         downloaded_at = excluded.downloaded_at,
         server_updated_at = excluded.server_updated_at
       WHERE NOT EXISTS (
         SELECT 1 FROM score_outbox
         WHERE match_id = excluded.match_id AND status = 'pending'
       )`,
      [String(match._id), JSON.stringify(match), catalog.downloadedAt, match.updatedAt || null]
    );
  }
}

export async function getOfflineCatalog() {
  const catalogJson = await getAppSetting("offline_catalog");
  if (!catalogJson) return null;
  return JSON.parse(catalogJson);
}

export async function getPendingScoreActions(matchId = null) {
  const database = await openDatabase();
  const result = matchId
    ? await database.query(
      `SELECT action_id, match_id, sequence, payload_json
       FROM score_outbox
       WHERE match_id = ? AND status = 'pending'
       ORDER BY sequence ASC`,
      [String(matchId)]
    )
    : await database.query(
      `SELECT action_id, match_id, sequence, payload_json
       FROM score_outbox
       WHERE status = 'pending'
       ORDER BY rowid ASC`
    );
  return (result.values || []).map((row) => ({
    actionId: row.action_id,
    matchId: row.match_id,
    sequence: Number(row.sequence),
    payload: JSON.parse(row.payload_json),
  }));
}

export async function markScoreActionsSynced(actionIds, match) {
  if (!actionIds.length) return;
  const database = await openDatabase();
  const placeholders = actionIds.map(() => "?").join(", ");
  const statements = [{
    statement: `UPDATE score_outbox SET status = 'synced'
      WHERE action_id IN (${placeholders}) AND status = 'pending'`,
    values: actionIds,
  }];
  if (match?._id) {
    statements.push({
      statement: "UPDATE downloaded_matches SET match_json = ? WHERE match_id = ?",
      values: [JSON.stringify(match), String(match._id)],
    });
  }
  await database.executeSet({ set: statements, transaction: true });
}
