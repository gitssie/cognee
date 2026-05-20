import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

export function init(connectionString: string) {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 10_000 });
  return drizzle({ client: pool, schema });
}

export type Schema = typeof schema;
export { schema };
