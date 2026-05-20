import { pgTable, text, bigint, primaryKey } from "drizzle-orm/pg-core";

export const allowlist = pgTable(
  "opr_allowlist",
  {
    channel: text("channel").notNull(),
    peer_id: text("peer_id").notNull(),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.peer_id] })],
);
