import TauriDatabase from "@tauri-apps/plugin-sql";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

const DB_URL = "sqlite:finance.db";

type Conn = Awaited<ReturnType<typeof TauriDatabase.load>>;
let connection: Conn | null = null;
let connectionPromise: Promise<Conn> | null = null;

async function getConnection(): Promise<Conn> {
  if (connection) return connection;
  if (!connectionPromise) {
    connectionPromise = TauriDatabase.load(DB_URL).then((db) => {
      connection = db;
      return db;
    });
  }
  return connectionPromise;
}

export const db: SqliteRemoteDatabase<typeof schema> = drizzle(
  async (sql, params, method) => {
    const conn = await getConnection();
    if (method === "run") {
      await conn.execute(sql, params as unknown[]);
      return { rows: [] };
    }
    const rows = (await conn.select(sql, params as unknown[])) as Record<
      string,
      unknown
    >[];
    return { rows: rows.map((r) => Object.values(r)) };
  },
  { schema, logger: false },
);

export { schema };
