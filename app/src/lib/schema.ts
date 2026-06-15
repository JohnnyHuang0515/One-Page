import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

// §3.2 Entities — amounts are integer TWD dollars (POC, see spec §1.6)

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)] // BR-11
);

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

export const ledgers = sqliteTable("ledgers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(), // -> users.id；亦即目前 owner（D-0006，可轉移）
  currency: text("currency").notNull().default("TWD"),
  // D-0006: 軟刪除/封存
  status: text("status", { enum: ["ACTIVE", "ARCHIVED"] }).notNull().default("ACTIVE"),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id").notNull(),
    userId: text("user_id").notNull(),
    // D-0006: 移除/自退 = 標記 REMOVED（停用、保留歷史）
    status: text("status", { enum: ["ACTIVE", "REMOVED"] }).notNull().default("ACTIVE"),
    removedAt: integer("removed_at", { mode: "timestamp" }),
    joinedAt: integer("joined_at", { mode: "timestamp" }).notNull(),
    // #2 動態：此人最後查看「動態」的時間（用來算未讀）
    activitySeenAt: integer("activity_seen_at", { mode: "timestamp" }),
  },
  (t) => [uniqueIndex("memberships_ledger_user_unique").on(t.ledgerId, t.userId)] // BR-6
);

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id").notNull(),
    code: text("code").notNull(),
    createdBy: text("created_by").notNull(), // -> memberships.id
    status: text("status", { enum: ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"] }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("invitations_code_unique").on(t.code)]
);

export const billingPeriods = sqliteTable(
  "billing_periods",
  {
    id: text("id").primaryKey(),
    ledgerId: text("ledger_id").notNull(),
    yearMonth: text("year_month").notNull(), // e.g. 2026-06
    status: text("status", { enum: ["OPEN", "SETTLED"] }).notNull(),
    settledAt: integer("settled_at", { mode: "timestamp" }),
    settledBy: text("settled_by"), // -> memberships.id
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("periods_ledger_month_unique").on(t.ledgerId, t.yearMonth)] // BR-8
);

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id").notNull(),
  billingPeriodId: text("billing_period_id").notNull(),
  payerId: text("payer_id").notNull(), // -> memberships.id
  description: text("description").notNull(),
  amount: integer("amount").notNull(), // BR-2: > 0
  spentAt: text("spent_at").notNull(), // YYYY-MM-DD
  splitMethod: text("split_method", { enum: ["EQUAL", "EXACT_AMOUNT"] }).notNull(),
  createdBy: text("created_by").notNull(), // -> memberships.id
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const expenseShares = sqliteTable("expense_shares", {
  id: text("id").primaryKey(),
  expenseId: text("expense_id").notNull(),
  memberId: text("member_id").notNull(), // -> memberships.id
  shareAmount: integer("share_amount").notNull(), // BR-1: sum = expense.amount
});

// #2 動態：append-only 活動事件流。記帳/編輯/刪除/標記已付/月結/成員加入時各寫一筆。
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id").notNull(),
  actorUserId: text("actor_user_id").notNull(), // -> users.id（操作者；用於頭像身分色）
  actorName: text("actor_name").notNull(), // 去正規化：成員被移除後仍能顯示其名
  type: text("type").notNull(), // EXPENSE_ADDED / EXPENSE_EDITED / EXPENSE_DELETED / SETTLEMENT_PAID / PERIOD_SETTLED / MEMBER_JOINED
  summary: text("summary").notNull(), // 去正規化的中文敘述（POC：寫入時定稿）
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const settlementTransactions = sqliteTable("settlement_transactions", {
  id: text("id").primaryKey(),
  billingPeriodId: text("billing_period_id").notNull(),
  fromMemberId: text("from_member_id").notNull(),
  toMemberId: text("to_member_id").notNull(),
  amount: integer("amount").notNull(),
  status: text("status", { enum: ["PENDING", "PAID"] }).notNull(),
  paidAt: integer("paid_at", { mode: "timestamp" }),
  paidBy: text("paid_by"), // -> memberships.id
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
