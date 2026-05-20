import { pgTable, text, bigint, primaryKey } from "drizzle-orm/pg-core";

export const sandboxes = pgTable(
  "opr_sandboxes",
  {
    channel: text("channel").notNull(),
    identity_id: text("identity_id").notNull(),
    peer_id: text("peer_id").notNull(),
    sandbox_id: text("sandbox_id").notNull(),
    status: text("status").notNull().default("unknown"),
    host_workspace_path: text("host_workspace_path").notNull().default(""),
    host_data_path: text("host_data_path").notNull().default(""),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
    updated_at: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.identity_id, t.peer_id] })],
);
