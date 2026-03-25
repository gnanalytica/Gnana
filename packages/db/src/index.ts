import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

// Re-export drizzle-orm operators to avoid duplicate-instance issues in monorepos
export {
  eq,
  and,
  or,
  desc,
  asc,
  sql,
  gt,
  gte,
  lt,
  lte,
  inArray,
  isNull,
  isNotNull,
} from "drizzle-orm";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}
