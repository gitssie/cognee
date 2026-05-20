import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/opencode-router/db/schema/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: process.env.OPENCODE_DB_URL ?? "postgresql://postgres:my-secret-pw@172.16.17.231:5432/opencode_test",
  },
});
