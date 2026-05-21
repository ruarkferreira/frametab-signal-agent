import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  serial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Platform tables (stubs — replace with your own favorites/watchlist source) ──

export const favoritesTable = pgTable(
  "favorites",
  {
    id: serial("id").primaryKey(),
    tokenId: text("token_id").notNull(),
    serial: integer("serial").notNull(),
    userId: text("user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
);

export const watchlistTable = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    tokenId: text("token_id").notNull(),
    serial: integer("serial").notNull(),
    userId: text("user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
);

// ── Signal Agent tables ───────────────────────────────────────────────────────

export const signalAgentEventsTable = pgTable(
  "signal_agent_events",
  {
    id: serial("id").primaryKey(),
    tokenId: text("token_id").notNull(),
    serial: integer("serial").notNull(),
    action: text("action").notNull(),
    source: text("source").notNull().default("user"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tokenSerialIdx: index("signal_agent_events_token_serial_idx").on(t.tokenId, t.serial),
    createdAtIdx: index("signal_agent_events_created_at_idx").on(t.createdAt),
  }),
);

export const signalAgentGroupsTable = pgTable(
  "signal_agent_groups",
  {
    id: serial("id").primaryKey(),
    windowDate: text("window_date").notNull(),
    tokenId: text("token_id").notNull(),
    serial: integer("serial").notNull(),
    ownerAccountId: text("owner_account_id"),
    favoriteCount: integer("favorite_count").notNull().default(0),
    watchCount: integer("watch_count").notNull().default(0),
    memo: text("memo"),
    status: text("status").notNull().default("pending"),
    riskFlags: jsonb("risk_flags").$type<string[]>().default([]),
    approvedAt: timestamp("approved_at"),
    approvedBy: text("approved_by"),
    ownerResolvedAt: timestamp("owner_resolved_at"),
    ownerAtApprovalTime: text("owner_at_approval_time"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    windowTokenSerialUnique: uniqueIndex("signal_agent_groups_window_token_serial_unique").on(
      t.windowDate,
      t.tokenId,
      t.serial,
    ),
    statusIdx: index("signal_agent_groups_status_idx").on(t.status),
    windowDateIdx: index("signal_agent_groups_window_date_idx").on(t.windowDate),
  }),
);

export const signalAgentTransactionsTable = pgTable(
  "signal_agent_transactions",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id").notNull(),
    tokenId: text("token_id").notNull(),
    serial: integer("serial").notNull(),
    recipientAccountId: text("recipient_account_id").notNull(),
    senderAccountId: text("sender_account_id").notNull(),
    amountTinybars: integer("amount_tinybars").notNull(),
    memo: text("memo").notNull(),
    txId: text("tx_id"),
    hashscanUrl: text("hashscan_url"),
    status: text("status").notNull().default("pending"),
    isDryRun: boolean("is_dry_run").notNull().default(false),
    error: text("error"),
    initiatedBy: text("initiated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    groupIdIdx: index("signal_agent_transactions_group_id_idx").on(t.groupId),
    statusIdx: index("signal_agent_transactions_status_idx").on(t.status),
    createdAtIdx: index("signal_agent_transactions_created_at_idx").on(t.createdAt),
  }),
);

export const signalAgentBlockedAccountsTable = pgTable(
  "signal_agent_blocked_accounts",
  {
    id: serial("id").primaryKey(),
    accountId: text("account_id").notNull().unique(),
    reason: text("reason"),
    blockedAt: timestamp("blocked_at").notNull().defaultNow(),
    blockedBy: text("blocked_by"),
  },
);

export type SignalAgentEvent = typeof signalAgentEventsTable.$inferSelect;
export type SignalAgentGroup = typeof signalAgentGroupsTable.$inferSelect;
export type SignalAgentTransaction = typeof signalAgentTransactionsTable.$inferSelect;
export type SignalAgentBlockedAccount = typeof signalAgentBlockedAccountsTable.$inferSelect;
