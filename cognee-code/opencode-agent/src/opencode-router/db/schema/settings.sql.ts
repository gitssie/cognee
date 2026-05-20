import { pgTable, text } from "drizzle-orm/pg-core";

export const settings = pgTable("opr_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
