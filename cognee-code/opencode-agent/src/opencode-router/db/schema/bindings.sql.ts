import { pgTable, text, bigint, primaryKey } from "drizzle-orm/pg-core";

export const bindings = pgTable(
  "opr_bindings",
  {
    channel: text("channel").notNull(),
    identity_id: text("identity_id").notNull(),
    peer_id: text("peer_id").notNull(),
    directory: text("directory").notNull(),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
    updated_at: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.identity_id, t.peer_id] })],
);
