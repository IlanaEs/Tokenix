import "dotenv/config";
import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/tokenix";

export const pool = new Pool({ connectionString: databaseUrl });
