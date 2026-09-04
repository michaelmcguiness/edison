import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const contentCategory = pgEnum("content_category", [
  "for-you",
  "tech-science",
  "business",
  "arts-culture",
  "sports",
  "entertainment",
]);

export const articleLength = pgEnum("article_length", [
  "brief",
  "standard",
  "deep",
]);

export const articleStatus = pgEnum("article_status", [
  "draft",
  "published",
  "archived",
]);

export const interestKind = pgEnum("interest_kind", [
  "explicit",
  "inferred",
  "knowledge",
]);

export const generationKind = pgEnum("generation_kind", [
  "initial-edition",
  "feed-replenishment",
  "learning-thread",
  "article-follow-up",
]);

export const generationStatus = pgEnum("generation_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const commandStatus = pgEnum("command_status", [
  "queued",
  "applied",
  "no-op",
  "failed",
]);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name"),
    onboardingComplete: boolean("onboarding_complete").notNull().default(false),
    currentStreak: integer("current_streak").notNull().default(0),
    lastReadDate: date("last_read_date", { mode: "string" }),
    timezone: text("timezone").notNull().default("UTC"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("profiles_email_unique").on(table.email),
    check("profiles_streak_nonnegative", sql`${table.currentStreak} >= 0`),
  ],
);

export const alphaMemberships = pgTable(
  "alpha_memberships",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    invitedBy: uuid("invited_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "alpha_memberships_status_valid",
      sql`${table.status} in ('active', 'revoked')`,
    ),
  ],
);

export const feedPreferences = pgTable(
  "feed_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleLength: articleLength("article_length").notNull().default("standard"),
    editorialBrief: text("editorial_brief").notNull().default(""),
    depth: smallint("depth").notNull().default(60),
    novelty: smallint("novelty").notNull().default(60),
    categoryVisibility: jsonb("category_visibility")
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    categoryOrder: jsonb("category_order")
      .$type<string[]>()
      .notNull()
      .default([]),
    inferredPreferences: jsonb("inferred_preferences")
      .$type<string[]>()
      .notNull()
      .default([]),
    knowledgeState: jsonb("knowledge_state")
      .$type<Array<{ topic: string; level: string; note: string | null }>>()
      .notNull()
      .default([]),
    ...timestamps,
  },
  (table) => [
    check("feed_preferences_depth_range", sql`${table.depth} between 0 and 100`),
    check(
      "feed_preferences_novelty_range",
      sql`${table.novelty} between 0 and 100`,
    ),
  ],
);

export const userInterests = pgTable(
  "user_interests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    kind: interestKind("kind").notNull().default("explicit"),
    weight: numeric("weight", { precision: 6, scale: 3 }).notNull().default("1"),
    status: text("status").notNull().default("active"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_interests_user_topic_kind_unique").on(
      table.userId,
      table.topic,
      table.kind,
    ),
    index("user_interests_user_status_idx").on(table.userId, table.status),
    check(
      "user_interests_status_valid",
      sql`${table.status} in ('active', 'muted', 'deleted')`,
    ),
  ],
);

export const learningThreads = pgTable(
  "learning_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status").notNull().default("active"),
    currentLevel: text("current_level").notNull().default("beginner"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("learning_threads_user_slug_unique").on(table.userId, table.slug),
    index("learning_threads_user_status_idx").on(table.userId, table.status),
  ],
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    learningThreadId: uuid("learning_thread_id").references(() => learningThreads.id, {
      onDelete: "set null",
    }),
    slug: text("slug").notNull(),
    status: articleStatus("status").notNull().default("draft"),
    category: contentCategory("category").notNull(),
    kicker: text("kicker").notNull(),
    topic: text("topic").notNull(),
    title: text("title").notNull(),
    deck: text("deck").notNull(),
    body: jsonb("body").$type<unknown[]>().notNull(),
    summary: jsonb("summary").$type<string[]>().notNull(),
    whyWritten: text("why_written").notNull(),
    readingMinutes: smallint("reading_minutes").notNull(),
    sourceCount: smallint("source_count").notNull().default(0),
    researchedAt: timestamp("researched_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    model: text("model"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("articles_owner_slug_unique").on(table.ownerId, table.slug),
    index("articles_owner_status_created_idx").on(
      table.ownerId,
      table.status,
      table.createdAt,
    ),
    check("articles_reading_minutes_positive", sql`${table.readingMinutes} > 0`),
    check("articles_source_count_nonnegative", sql`${table.sourceCount} >= 0`),
    check("articles_summary_three_items", sql`jsonb_array_length(${table.summary}) = 3`),
  ],
);

export const articleSources = pgTable(
  "article_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    citationOrder: smallint("citation_order").notNull(),
    title: text("title").notNull(),
    publisher: text("publisher").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    accessedAt: timestamp("accessed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    citedClaims: jsonb("cited_claims").$type<string[]>().notNull().default([]),
  },
  (table) => [
    uniqueIndex("article_sources_article_url_unique").on(table.articleId, table.url),
    uniqueIndex("article_sources_article_order_unique").on(
      table.articleId,
      table.citationOrder,
    ),
    index("article_sources_article_idx").on(table.articleId),
    check("article_sources_order_positive", sql`${table.citationOrder} > 0`),
  ],
);

export const feedItems = pgTable(
  "feed_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    category: contentCategory("category").notNull(),
    editionDate: date("edition_date", { mode: "string" }).notNull(),
    rank: numeric("rank", { precision: 20, scale: 6 }).notNull(),
    reason: text("reason").notNull(),
    servedAt: timestamp("served_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("feed_items_user_article_unique").on(table.userId, table.articleId),
    index("feed_items_user_category_rank_idx").on(
      table.userId,
      table.category,
      table.editionDate,
      table.rank,
    ),
  ],
);

export const readingEvents = pgTable(
  "reading_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("reading_events_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("reading_events_user_time_idx").on(table.userId, table.occurredAt),
    index("reading_events_article_idx").on(table.articleId),
  ],
);

export const savedArticles = pgTable(
  "saved_articles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.articleId] }),
    index("saved_articles_user_time_idx").on(table.userId, table.savedAt),
  ],
);

export const articleFeedback = pgTable(
  "article_feedback",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    worthYourTime: boolean("worth_your_time").notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.articleId] })],
);

export const feedCommands = pgTable(
  "feed_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    structuredUpdate: jsonb("structured_update").$type<unknown[]>(),
    status: commandStatus("status").notNull().default("queued"),
    error: text("error"),
    workflowRunId: text("workflow_run_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("feed_commands_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("feed_commands_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("feed_commands_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const articleConversations = pgTable(
  "article_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    title: text("title"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("article_conversations_user_article_unique").on(
      table.userId,
      table.articleId,
    ),
  ],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => articleConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<unknown[]>().notNull().default([]),
    idempotencyKey: text("idempotency_key"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("conversation_messages_conversation_time_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    uniqueIndex("conversation_messages_idempotency_unique")
      .on(table.conversationId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check("conversation_messages_role_valid", sql`${table.role} in ('user', 'assistant')`),
  ],
);

export const articleShares = pgTable(
  "article_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("article_shares_slug_unique").on(table.slug),
    uniqueIndex("article_shares_user_article_unique").on(table.userId, table.articleId),
  ],
);

export const privateSchema = pgSchema("private");

export const generationJobs = privateSchema.table(
  "generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: generationKind("kind").notNull(),
    status: generationStatus("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    workflowRunId: text("workflow_run_id"),
    providerResponseId: text("provider_response_id"),
    outputArticleId: uuid("output_article_id").references(() => articles.id, {
      onDelete: "set null",
    }),
    model: text("model"),
    attemptCount: smallint("attempt_count").notNull().default(0),
    failureCode: text("failure_code"),
    error: text("error"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("generation_jobs_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("generation_jobs_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("generation_jobs_user_created_idx").on(table.userId, table.createdAt),
    check("generation_jobs_attempt_nonnegative", sql`${table.attemptCount} >= 0`),
  ],
);

export const usageLedger = privateSchema.table(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    generationJobId: uuid("generation_job_id").references(() => generationJobs.id, {
      onDelete: "set null",
    }),
    operation: text("operation").notNull(),
    provider: text("provider").notNull().default("openai"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    webSearchCalls: smallint("web_search_calls").notNull().default(0),
    costMicrousd: bigint("cost_microusd", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("usage_ledger_user_created_idx").on(table.userId, table.createdAt),
    check("usage_ledger_tokens_nonnegative", sql`
      ${table.inputTokens} >= 0 and
      ${table.cachedInputTokens} >= 0 and
      ${table.outputTokens} >= 0 and
      ${table.webSearchCalls} >= 0 and
      ${table.costMicrousd} >= 0
    `),
  ],
);

export const webhookEvents = privateSchema.table(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("webhook_events_unprocessed_idx").on(table.processedAt)],
);
