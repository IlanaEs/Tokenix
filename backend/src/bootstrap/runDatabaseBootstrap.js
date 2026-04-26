import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = path.resolve(__dirname, "../../db");
const INIT_SQL_PATH = path.join(DB_DIR, "init.sql");
const ENSURE_SCHEMA_SQL_PATH = path.join(DB_DIR, "ensure-current-schema.sql");
const MIGRATIONS_DIR = path.join(DB_DIR, "migrations");

async function runSqlFile(client, filePath) {
  const sql = await fs.readFile(filePath, "utf8");
  if (!sql.trim()) {
    return;
  }

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runDatabaseBootstrap() {
  const client = await pool.connect();

  try {
    await runSqlFile(client, INIT_SQL_PATH);
    await runSqlFile(client, ENSURE_SCHEMA_SQL_PATH);

    const migrationFiles = (await fs.readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const fileName of migrationFiles) {
      await runSqlFile(client, path.join(MIGRATIONS_DIR, fileName));
    }
  } finally {
    client.release();
  }
}
