import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
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
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
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

export const publicationSection = pgEnum("publication_section", [
  "news",
  "books",
  "podcasts",
]);

export const editorialDirectionScope = pgEnum("editorial_direction_scope", [
  "persistent",
  "edition",
]);

export const editorialDirectionOperation = pgEnum(
  "editorial_direction_operation",
  ["create", "update", "delete", "undo"],
);

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

export const editorialDirectionStates = pgTable(
  "editorial_direction_states",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    section: publicationSection("section").notNull(),
    revision: integer("revision").notNull().default(0),
    currentEditionId: uuid("current_edition_id").notNull().defaultRandom(),
    currentEditionDate: date("current_edition_date", { mode: "string" }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.section] }),
    uniqueIndex("editorial_direction_states_edition_unique").on(
      table.currentEditionId,
    ),
    check(
      "editorial_direction_states_revision_nonnegative",
      sql`${table.revision} >= 0`,
    ),
  ],
);

export const editorialInstructions = pgTable(
  "editorial_instructions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    section: publicationSection("section").notNull(),
    scope: editorialDirectionScope("scope").notNull(),
    editionId: uuid("edition_id"),
    text: text("text").notNull(),
    revision: integer("revision").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.section],
      foreignColumns: [
        editorialDirectionStates.userId,
        editorialDirectionStates.section,
      ],
      name: "editorial_instructions_state_fk",
    }).onDelete("cascade"),
    index("editorial_instructions_user_section_idx").on(
      table.userId,
      table.section,
      table.createdAt,
    ),
    check(
      "editorial_instructions_scope_edition_consistent",
      sql`(
        (${table.scope} = 'persistent' and ${table.editionId} is null)
        or
        (${table.scope} = 'edition' and ${table.editionId} is not null)
      )`,
    ),
    check(
      "editorial_instructions_text_length",
      sql`char_length(btrim(${table.text})) between 3 and 1000`,
    ),
    check("editorial_instructions_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const editorialDirectionMutations = pgTable(
  "editorial_direction_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    section: publicationSection("section").notNull(),
    operation: editorialDirectionOperation("operation").notNull(),
    instructionId: uuid("instruction_id")
      .notNull()
      .references(() => editorialInstructions.id, { onDelete: "cascade" }),
    baseRevision: integer("base_revision").notNull(),
    resultingRevision: integer("resulting_revision").notNull(),
    beforeSnapshot: jsonb("before_snapshot").$type<Record<string, unknown>>(),
    afterSnapshot: jsonb("after_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    undoOfMutationId: uuid("undo_of_mutation_id").references(
      (): AnyPgColumn => editorialDirectionMutations.id,
      { onDelete: "cascade" },
    ),
    revertedByMutationId: uuid("reverted_by_mutation_id").references(
      (): AnyPgColumn => editorialDirectionMutations.id,
      { onDelete: "cascade" },
    ),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.section],
      foreignColumns: [
        editorialDirectionStates.userId,
        editorialDirectionStates.section,
      ],
      name: "editorial_direction_mutations_state_fk",
    }).onDelete("cascade"),
    uniqueIndex("editorial_direction_mutations_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("editorial_direction_mutations_undo_once_unique")
      .on(table.undoOfMutationId)
      .where(sql`${table.undoOfMutationId} is not null`),
    index("editorial_direction_mutations_user_section_revision_idx").on(
      table.userId,
      table.section,
      table.resultingRevision,
    ),
    check(
      "editorial_direction_mutations_revision_step",
      sql`${table.baseRevision} >= 0 and ${table.resultingRevision} = ${table.baseRevision} + 1`,
    ),
    check(
      "editorial_direction_mutations_fingerprint_length",
      sql`char_length(${table.requestFingerprint}) = 64`,
    ),
    check(
      "editorial_direction_mutations_idempotency_key_valid",
      sql`char_length(${table.idempotencyKey}) between 8 and 128 and ${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`,
    ),
    check(
      "editorial_direction_mutations_snapshot_consistent",
      sql`
        jsonb_typeof(${table.afterSnapshot}) = 'object'
        and (
          (${table.operation} = 'create' and ${table.beforeSnapshot} is null)
          or
          (${table.operation} <> 'create' and jsonb_typeof(${table.beforeSnapshot}) = 'object')
        )
      `,
    ),
    check(
      "editorial_direction_mutations_undo_consistent",
      sql`(${table.operation} = 'undo') = (${table.undoOfMutationId} is not null)`,
    ),
  ],
);

export const publicStarterEditions = pgTable(
  "public_starter_editions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    section: publicationSection("section").notNull(),
    editionDate: date("edition_date", { mode: "string" }).notNull(),
    label: text("label").notNull().default("A place to begin"),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("public_starter_editions_section_date_unique").on(
      table.section,
      table.editionDate,
    ),
    uniqueIndex("public_starter_editions_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("public_starter_editions_current_idx").on(
      table.section,
      table.status,
      table.publishedAt,
    ),
    check(
      "public_starter_editions_status_valid",
      sql`${table.status} in ('draft', 'published', 'archived')`,
    ),
    check(
      "public_starter_editions_publication_consistent",
      sql`(
        (${table.status} = 'draft' and ${table.publishedAt} is null)
        or
        (${table.status} in ('published', 'archived') and ${table.publishedAt} is not null)
      )`,
    ),
    check(
      "public_starter_editions_label_length",
      sql`char_length(btrim(${table.label})) between 1 and 120`,
    ),
    check(
      "public_starter_editions_fingerprint_length",
      sql`char_length(${table.requestFingerprint}) = 64`,
    ),
    check(
      "public_starter_editions_idempotency_key_valid",
      sql`char_length(${table.idempotencyKey}) between 8 and 128 and ${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`,
    ),
  ],
);

export const publicStarterEditionArticles = pgTable(
  "public_starter_edition_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id")
      .notNull()
      .references(() => publicStarterEditions.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    reason: text("reason").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("public_starter_edition_articles_position_unique").on(
      table.editionId,
      table.position,
    ),
    check(
      "public_starter_edition_articles_position_positive",
      sql`${table.position} > 0`,
    ),
    check(
      "public_starter_edition_articles_reason_length",
      sql`char_length(btrim(${table.reason})) between 1 and 500`,
    ),
    check(
      "public_starter_edition_articles_snapshot_object",
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
    ),
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
      .$type<
        Array<{
          topic: string;
          level: "new" | "beginner" | "intermediate" | "advanced";
          note: string | null;
        }>
      >()
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
    check(
      "feed_preferences_knowledge_state_bounded",
      sql`private.knowledge_state_is_bounded(${table.knowledgeState})`,
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
    normalizedTitle: text("normalized_title").notNull(),
    originalCuriosity: text("original_curiosity").notNull(),
    direction: text("direction").notNull().default(""),
    revision: integer("revision").notNull().default(0),
    creationIdempotencyKey: text("creation_idempotency_key").notNull(),
    creationRequestFingerprint: text("creation_request_fingerprint").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status").notNull().default("active"),
    currentLevel: text("current_level").notNull().default("unspecified"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("learning_threads_id_user_unique").on(table.id, table.userId),
    uniqueIndex("learning_threads_user_slug_unique").on(table.userId, table.slug),
    uniqueIndex("learning_threads_user_normalized_title_unique").on(
      table.userId,
      table.normalizedTitle,
    ),
    uniqueIndex("learning_threads_user_creation_key_unique").on(
      table.userId,
      table.creationIdempotencyKey,
    ),
    index("learning_threads_user_status_idx").on(table.userId, table.status),
    check(
      "learning_threads_title_length",
      sql`char_length(btrim(${table.title})) between 1 and 120`,
    ),
    check(
      "learning_threads_normalized_title_valid",
      sql`char_length(${table.normalizedTitle}) between 1 and 120 and ${table.normalizedTitle} = lower(regexp_replace(btrim(${table.normalizedTitle}), '[[:space:]]+', ' ', 'g'))`,
    ),
    check(
      "learning_threads_original_curiosity_length",
      sql`char_length(btrim(${table.originalCuriosity})) between 1 and 500`,
    ),
    check(
      "learning_threads_direction_length",
      sql`${table.direction} = btrim(${table.direction}) and char_length(${table.direction}) <= 1000`,
    ),
    check(
      "learning_threads_revision_nonnegative",
      sql`${table.revision} >= 0`,
    ),
    check(
      "learning_threads_status_valid",
      sql`${table.status} in ('active', 'paused', 'archived')`,
    ),
    check(
      "learning_threads_creation_key_valid",
      sql`char_length(${table.creationIdempotencyKey}) between 8 and 128 and ${table.creationIdempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`,
    ),
    check(
      "learning_threads_creation_fingerprint_length",
      sql`char_length(${table.creationRequestFingerprint}) = 64`,
    ),
  ],
);

export const learningLoopDirectionMutations = pgTable(
  "learning_loop_direction_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loopId: uuid("loop_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    baseRevision: integer("base_revision").notNull(),
    resultingRevision: integer("resulting_revision").notNull(),
    beforeDirection: text("before_direction").notNull(),
    afterDirection: text("after_direction").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    undoOfMutationId: uuid("undo_of_mutation_id").references(
      (): AnyPgColumn => learningLoopDirectionMutations.id,
      { onDelete: "cascade" },
    ),
    revertedByMutationId: uuid("reverted_by_mutation_id").references(
      (): AnyPgColumn => learningLoopDirectionMutations.id,
      { onDelete: "cascade" },
    ),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.loopId, table.userId],
      foreignColumns: [learningThreads.id, learningThreads.userId],
      name: "learning_loop_direction_mutations_loop_owner_fk",
    }).onDelete("cascade"),
    uniqueIndex("learning_loop_direction_mutations_user_key_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("learning_loop_direction_mutations_undo_once_unique").on(
      table.undoOfMutationId,
    ),
    index("learning_loop_direction_mutations_reverted_by_idx").on(
      table.revertedByMutationId,
    ),
    uniqueIndex("learning_loop_direction_mutations_loop_revision_unique").on(
      table.loopId,
      table.resultingRevision,
    ),
    check(
      "learning_loop_direction_mutations_operation_valid",
      sql`${table.operation} in ('set', 'undo')`,
    ),
    check(
      "learning_loop_direction_mutations_revision_step",
      sql`${table.baseRevision} >= 0 and ${table.resultingRevision} = ${table.baseRevision} + 1`,
    ),
    check(
      "learning_loop_direction_mutations_direction_length",
      sql`${table.beforeDirection} = btrim(${table.beforeDirection}) and ${table.afterDirection} = btrim(${table.afterDirection}) and char_length(${table.beforeDirection}) <= 1000 and char_length(${table.afterDirection}) <= 1000`,
    ),
    check(
      "learning_loop_direction_mutations_key_valid",
      sql`char_length(${table.idempotencyKey}) between 8 and 128 and ${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`,
    ),
    check(
      "learning_loop_direction_mutations_fingerprint_length",
      sql`char_length(${table.requestFingerprint}) = 64`,
    ),
    check(
      "learning_loop_direction_mutations_undo_consistent",
      sql`(${table.operation} = 'undo') = (${table.undoOfMutationId} is not null)`,
    ),
  ],
);

export const learningLoopPublicArticles = pgTable(
  "learning_loop_public_articles",
  {
    loopId: uuid("loop_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    publicArticleId: uuid("public_article_id")
      .notNull()
      .references(() => publicStarterEditionArticles.id, {
        onDelete: "restrict",
      }),
    position: smallint("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.loopId, table.publicArticleId] }),
    foreignKey({
      columns: [table.loopId, table.userId],
      foreignColumns: [learningThreads.id, learningThreads.userId],
      name: "learning_loop_public_articles_loop_owner_fk",
    }).onDelete("cascade"),
    uniqueIndex("learning_loop_public_articles_position_unique").on(
      table.loopId,
      table.position,
    ),
    index("learning_loop_public_articles_user_idx").on(
      table.userId,
      table.loopId,
    ),
    index("learning_loop_public_articles_article_idx").on(
      table.publicArticleId,
    ),
    check(
      "learning_loop_public_articles_position_bounded",
      sql`${table.position} between 1 and 30`,
    ),
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
    foreignKey({
      columns: [table.learningThreadId, table.ownerId],
      foreignColumns: [learningThreads.id, learningThreads.userId],
      name: "articles_learning_loop_owner_fk",
    }),
    uniqueIndex("articles_owner_slug_unique").on(table.ownerId, table.slug),
    index("articles_learning_thread_idx").on(table.learningThreadId),
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
    editionId: uuid("edition_id"),
    editionDate: date("edition_date", { mode: "string" }).notNull(),
    rank: numeric("rank", { precision: 20, scale: 6 }).notNull(),
    reason: text("reason").notNull(),
    servedAt: timestamp("served_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("feed_items_user_article_unique").on(table.userId, table.articleId),
    index("feed_items_user_edition_category_rank_idx").on(
      table.userId,
      table.editionId,
      table.category,
      table.rank,
    ),
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

/**
 * A durable, per-reader reservation for every AI request path that is not
 * already represented by a generation job. The row is created before work is
 * dispatched, then claimed with a bounded lease immediately before calling the
 * provider. This makes the rolling quota and in-flight idempotency decisions
 * database-atomic without holding a transaction open across the provider call.
 */
export const aiRequestReservations = privateSchema.table(
  "ai_request_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    resourceId: uuid("resource_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    requestSnapshot: jsonb("request_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    status: text("status").notNull().default("reserved"),
    attemptCount: smallint("attempt_count").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    providerResponseId: text("provider_response_id"),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("ai_request_reservations_user_operation_key_unique").on(
      table.userId,
      table.operation,
      table.idempotencyKey,
    ),
    index("ai_request_reservations_user_operation_created_idx").on(
      table.userId,
      table.operation,
      table.createdAt,
    ),
    index("ai_request_reservations_claim_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    check(
      "ai_request_reservations_operation_valid",
      sql`${table.operation} in ('article_qa', 'preference_command')`,
    ),
    check(
      "ai_request_reservations_status_valid",
      sql`${table.status} in ('reserved', 'in_progress', 'succeeded', 'failed')`,
    ),
    check(
      "ai_request_reservations_idempotency_key_valid",
      sql`char_length(${table.idempotencyKey}) between 8 and 128 and ${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`,
    ),
    check(
      "ai_request_reservations_fingerprint_length",
      sql`char_length(${table.requestFingerprint}) = 64`,
    ),
    check(
      "ai_request_reservations_snapshot_valid",
      sql`jsonb_typeof(${table.requestSnapshot}) = 'object' and pg_column_size(${table.requestSnapshot}) <= 1048576`,
    ),
    check(
      "ai_request_reservations_attempt_range",
      sql`${table.attemptCount} between 0 and 3`,
    ),
    check(
      "ai_request_reservations_lease_consistent",
      sql`(
        (${table.status} = 'in_progress' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)
        or
        (${table.status} <> 'in_progress' and ${table.leaseOwner} is null and ${table.leaseExpiresAt} is null)
      )`,
    ),
    check(
      "ai_request_reservations_finish_consistent",
      sql`(
        (${table.status} in ('reserved', 'in_progress') and ${table.finishedAt} is null)
        or
        (${table.status} in ('succeeded', 'failed') and ${table.finishedAt} is not null)
      )`,
    ),
    check(
      "ai_request_reservations_success_has_provider_response",
      sql`${table.status} <> 'succeeded' or ${table.providerResponseId} is not null`,
    ),
  ],
);

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
    aiRequestReservationId: uuid("ai_request_reservation_id").references(
      () => aiRequestReservations.id,
      { onDelete: "set null" },
    ),
    operation: text("operation").notNull(),
    provider: text("provider").notNull().default("openai"),
    providerResponseId: text("provider_response_id"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    webSearchCalls: smallint("web_search_calls").notNull().default(0),
    pricingStatus: text("pricing_status").notNull().default("priced"),
    costMicrousd: bigint("cost_microusd", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("usage_ledger_user_created_idx").on(table.userId, table.createdAt),
    index("usage_ledger_ai_request_idx").on(table.aiRequestReservationId),
    uniqueIndex("usage_ledger_provider_response_unique")
      .on(table.provider, table.providerResponseId)
      .where(sql`${table.providerResponseId} is not null`),
    check(
      "usage_ledger_ai_request_has_provider_response",
      sql`${table.aiRequestReservationId} is null or ${table.providerResponseId} is not null`,
    ),
    check(
      "usage_ledger_pricing_consistent",
      sql`(
        (${table.pricingStatus} = 'priced' and ${table.costMicrousd} is not null)
        or
        (${table.pricingStatus} = 'unpriced' and ${table.costMicrousd} is null)
      )`,
    ),
    check("usage_ledger_tokens_nonnegative", sql`
      ${table.inputTokens} >= 0 and
      ${table.cachedInputTokens} >= 0 and
      ${table.outputTokens} >= 0 and
      ${table.webSearchCalls} >= 0 and
      (${table.costMicrousd} is null or ${table.costMicrousd} >= 0)
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

/**
 * A demand principal is deliberately separate from Supabase Auth. Account
 * readers bind to an existing profile; guests authenticate with a high-entropy
 * opaque token whose lowercase SHA-256 digest is the only credential retained
 * in the database.
 */
export const demandPrincipals = privateSchema.table(
  "demand_principals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountUserId: uuid("account_user_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    guestTokenHash: text("guest_token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("demand_principals_account_user_unique")
      .on(table.accountUserId)
      .where(sql`${table.accountUserId} is not null`),
    uniqueIndex("demand_principals_guest_token_hash_unique")
      .on(table.guestTokenHash)
      .where(sql`${table.guestTokenHash} is not null`),
    check(
      "demand_principals_exactly_one_binding",
      sql`num_nonnulls(${table.accountUserId}, ${table.guestTokenHash}) = 1`,
    ),
    check(
      "demand_principals_guest_token_hash_valid",
      sql`${table.guestTokenHash} is null or ${table.guestTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "demand_principals_expiry_consistent",
      sql`(
        (${table.accountUserId} is not null and ${table.expiresAt} is null)
        or
        (${table.guestTokenHash} is not null and ${table.expiresAt} is not null and ${table.expiresAt} > ${table.createdAt})
      )`,
    ),
    check(
      "demand_principals_revocation_time_valid",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const demandLoops = privateSchema.table(
  "demand_loops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => demandPrincipals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    originalCuriosity: text("original_curiosity").notNull(),
    editorInstructions: text("editor_instructions"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(0),
    principles: jsonb("principles")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("demand_loops_principal_id_unique").on(
      table.principalId,
      table.id,
    ),
    index("demand_loops_principal_created_idx").on(
      table.principalId,
      table.createdAt,
    ),
    check(
      "demand_loops_title_length",
      sql`${table.title} = btrim(${table.title}) and char_length(${table.title}) between 1 and 120`,
    ),
    check(
      "demand_loops_curiosity_length",
      sql`${table.originalCuriosity} = btrim(${table.originalCuriosity}) and char_length(${table.originalCuriosity}) between 1 and 500`,
    ),
    check("demand_loops_revision_nonnegative", sql`${table.revision} >= 0`),
    check("demand_loops_editor_instructions_length", sql`${table.editorInstructions} is null or char_length(${table.editorInstructions}) <= 500`),
    check(
      "demand_loops_principles_valid",
      sql`jsonb_typeof(${table.principles}) = 'object' and pg_column_size(${table.principles}) <= 65536`,
    ),
  ],
);

export const demandRequests = privateSchema.table(
  "demand_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => demandPrincipals.id, { onDelete: "cascade" }),
    loopId: uuid("loop_id").notNull(),
    ideaId: uuid("idea_id"),
    kind: text("kind")
      .$type<"ideas" | "article" | "feedback" | "question">()
      .notNull(),
    status: text("status")
      .$type<"queued" | "running" | "succeeded" | "failed">()
      .notNull()
      .default("queued"),
    stage: text("stage").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    snapshot: jsonb("snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    progress: jsonb("progress").$type<Record<string, unknown>>(),
    failureCode: text("failure_code"),
    workflowRunId: text("workflow_run_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    reservedMicrousd: integer("reserved_microusd").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("demand_requests_principal_key_unique").on(
      table.principalId,
      table.idempotencyKey,
    ),
    uniqueIndex("demand_requests_principal_id_unique").on(
      table.principalId,
      table.id,
    ),
    uniqueIndex("demand_requests_principal_loop_id_unique").on(
      table.principalId,
      table.loopId,
      table.id,
    ),
    uniqueIndex("demand_requests_article_idea_unique")
      .on(table.principalId, table.ideaId)
      .where(sql`${table.kind} = 'article' and ${table.ideaId} is not null`),
    index("demand_requests_claim_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    index("demand_requests_principal_created_idx").on(
      table.principalId,
      table.createdAt,
    ),
    index("demand_requests_created_idx").on(table.createdAt),
    index("demand_requests_conversation_idx").on(table.principalId, table.ideaId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.kind} = 'question'`),
    foreignKey({
      columns: [table.principalId, table.loopId],
      foreignColumns: [demandLoops.principalId, demandLoops.id],
      name: "demand_requests_loop_owner_fk",
    }).onDelete("cascade"),
    // The reverse composite idea-owner FK is installed by the SQL migration
    // after both sides of this intentionally circular relationship exist.
    check(
      "demand_requests_kind_valid",
      sql`${table.kind} in ('ideas', 'article', 'feedback', 'question')`,
    ),
    check(
      "demand_requests_status_valid",
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed')`,
    ),
    check(
      "demand_requests_stage_valid",
      sql`${table.stage} = btrim(${table.stage}) and char_length(${table.stage}) between 1 and 80`,
    ),
    check(
      "demand_requests_key_valid",
      sql`char_length(${table.idempotencyKey}) between 8 and 128 and ${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`,
    ),
    check(
      "demand_requests_fingerprint_valid",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "demand_requests_snapshot_valid",
      sql`jsonb_typeof(${table.snapshot}) = 'object' and pg_column_size(${table.snapshot}) <= 1048576`,
    ),
    check(
      "demand_requests_result_valid",
      sql`${table.result} is null or (jsonb_typeof(${table.result}) = 'object' and pg_column_size(${table.result}) <= 4194304)`,
    ),
    check(
      "demand_requests_progress_valid",
      sql`${table.progress} is null or (jsonb_typeof(${table.progress}) = 'object' and pg_column_size(${table.progress}) <= 4194304)`,
    ),
    check(
      "demand_requests_failure_code_valid",
      sql`${table.failureCode} is null or (${table.failureCode} = btrim(${table.failureCode}) and char_length(${table.failureCode}) between 1 and 100)`,
    ),
    check(
      "demand_requests_workflow_run_valid",
      sql`${table.workflowRunId} is null or char_length(${table.workflowRunId}) between 1 and 200`,
    ),
    check("demand_requests_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check(
      "demand_requests_reservation_nonnegative",
      sql`${table.reservedMicrousd} >= 0`,
    ),
    check(
      "demand_requests_article_has_idea",
      sql`${table.kind} <> 'article' or ${table.ideaId} is not null`,
    ),
  ],
);

export const demandIdeas = privateSchema.table(
  "demand_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => demandPrincipals.id, { onDelete: "cascade" }),
    loopId: uuid("loop_id").notNull(),
    batchRequestId: uuid("batch_request_id").notNull(),
    batchRevision: integer("batch_revision").notNull(),
    rank: smallint("rank").notNull().default(1),
    title: text("title").notNull(),
    deck: text("deck").notNull(),
    brief: jsonb("brief").$type<Record<string, unknown>>().notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    articleRequestId: uuid("article_request_id"),
    saved: boolean("saved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("demand_ideas_principal_id_unique").on(
      table.principalId,
      table.id,
    ),
    uniqueIndex("demand_ideas_principal_loop_id_unique").on(
      table.principalId,
      table.loopId,
      table.id,
    ),
    uniqueIndex("demand_ideas_article_request_unique")
      .on(table.articleRequestId)
      .where(sql`${table.articleRequestId} is not null`),
    index("demand_ideas_loop_batch_idx").on(
      table.principalId,
      table.loopId,
      table.batchRequestId,
    ),
    foreignKey({
      columns: [table.principalId, table.loopId],
      foreignColumns: [demandLoops.principalId, demandLoops.id],
      name: "demand_ideas_loop_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.principalId, table.loopId, table.batchRequestId],
      foreignColumns: [
        demandRequests.principalId,
        demandRequests.loopId,
        demandRequests.id,
      ],
      name: "demand_ideas_batch_request_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.principalId, table.loopId, table.articleRequestId],
      foreignColumns: [
        demandRequests.principalId,
        demandRequests.loopId,
        demandRequests.id,
      ],
      name: "demand_ideas_article_request_owner_fk",
    }).onDelete("cascade"),
    check("demand_ideas_batch_revision_nonnegative", sql`${table.batchRevision} >= 0`),
    check("demand_ideas_rank_valid", sql`${table.rank} between 1 and 6`),
    check(
      "demand_ideas_title_length",
      sql`${table.title} = btrim(${table.title}) and char_length(${table.title}) between 1 and 180`,
    ),
    check(
      "demand_ideas_deck_length",
      sql`${table.deck} = btrim(${table.deck}) and char_length(${table.deck}) between 1 and 500`,
    ),
    check(
      "demand_ideas_brief_valid",
      sql`jsonb_typeof(${table.brief}) = 'object' and pg_column_size(${table.brief}) <= 262144`,
    ),
    check(
      "demand_ideas_evidence_valid",
      sql`jsonb_typeof(${table.evidence}) = 'object' and pg_column_size(${table.evidence}) <= 1048576`,
    ),
  ],
);

export const demandStages = privateSchema.table(
  "demand_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => demandPrincipals.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    stageKey: text("stage_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    snapshot: jsonb("snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    status: text("status")
      .$type<"reserved" | "succeeded" | "failed" | "uncertain">()
      .notNull()
      .default("reserved"),
    providerResponseId: text("provider_response_id"),
    output: jsonb("output").$type<Record<string, unknown>>(),
    usage: jsonb("usage").$type<Record<string, unknown>>(),
    costMicrousd: integer("cost_microusd"),
    pricingStatus: text("pricing_status").$type<"priced" | "unpriced">(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("demand_stages_request_key_unique").on(
      table.requestId,
      table.stageKey,
    ),
    uniqueIndex("demand_stages_principal_request_id_unique").on(
      table.principalId,
      table.requestId,
      table.id,
    ),
    uniqueIndex("demand_stages_provider_response_unique")
      .on(table.providerResponseId)
      .where(sql`${table.providerResponseId} is not null`),
    index("demand_stages_lease_idx").on(table.status, table.leaseExpiresAt),
    foreignKey({
      columns: [table.principalId, table.requestId],
      foreignColumns: [demandRequests.principalId, demandRequests.id],
      name: "demand_stages_request_owner_fk",
    }).onDelete("cascade"),
    check(
      "demand_stages_key_valid",
      sql`${table.stageKey} = btrim(${table.stageKey}) and char_length(${table.stageKey}) between 1 and 80`,
    ),
    check(
      "demand_stages_fingerprint_valid",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "demand_stages_snapshot_valid",
      sql`jsonb_typeof(${table.snapshot}) = 'object' and pg_column_size(${table.snapshot}) <= 1048576`,
    ),
    check(
      "demand_stages_status_valid",
      sql`${table.status} in ('reserved', 'succeeded', 'failed', 'uncertain')`,
    ),
    check(
      "demand_stages_success_complete",
      sql`${table.status} <> 'succeeded' or (${table.providerResponseId} is not null and ${table.output} is not null and ${table.pricingStatus} is not null)`,
    ),
    check(
      "demand_stages_response_id_valid",
      sql`${table.providerResponseId} is null or (${table.providerResponseId} = btrim(${table.providerResponseId}) and char_length(${table.providerResponseId}) between 1 and 200)`,
    ),
    check(
      "demand_stages_output_valid",
      sql`${table.output} is null or (jsonb_typeof(${table.output}) = 'object' and pg_column_size(${table.output}) <= 4194304)`,
    ),
    check(
      "demand_stages_usage_valid",
      sql`${table.usage} is null or (jsonb_typeof(${table.usage}) = 'object' and pg_column_size(${table.usage}) <= 65536)`,
    ),
    check(
      "demand_stages_cost_nonnegative",
      sql`${table.costMicrousd} is null or ${table.costMicrousd} >= 0`,
    ),
    check(
      "demand_stages_pricing_valid",
      sql`(
        (${table.pricingStatus} is null and ${table.costMicrousd} is null)
        or
        (${table.pricingStatus} = 'priced' and ${table.costMicrousd} is not null)
        or
        (${table.pricingStatus} = 'unpriced' and ${table.costMicrousd} is null)
      )`,
    ),
  ],
);

export const demandMutations = privateSchema.table(
  "demand_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => demandPrincipals.id, { onDelete: "cascade" }),
    loopId: uuid("loop_id").notNull(),
    requestId: uuid("request_id").notNull(),
    receipt: jsonb("receipt").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("demand_mutations_request_unique").on(table.requestId),
    index("demand_mutations_loop_created_idx").on(
      table.principalId,
      table.loopId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.principalId, table.loopId],
      foreignColumns: [demandLoops.principalId, demandLoops.id],
      name: "demand_mutations_loop_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.principalId, table.loopId, table.requestId],
      foreignColumns: [
        demandRequests.principalId,
        demandRequests.loopId,
        demandRequests.id,
      ],
      name: "demand_mutations_request_owner_fk",
    }).onDelete("cascade"),
    check(
      "demand_mutations_receipt_valid",
      sql`jsonb_typeof(${table.receipt}) = 'object' and pg_column_size(${table.receipt}) <= 262144`,
    ),
  ],
);

export const demandEvents = privateSchema.table(
  "demand_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => demandPrincipals.id, { onDelete: "cascade" }),
    loopId: uuid("loop_id").notNull(),
    ideaId: uuid("idea_id"),
    type: text("type").$type<"opened" | "saved" | "progress">().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("demand_events_principal_key_unique").on(
      table.principalId,
      table.idempotencyKey,
    ),
    index("demand_events_loop_created_idx").on(
      table.principalId,
      table.loopId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.principalId, table.loopId],
      foreignColumns: [demandLoops.principalId, demandLoops.id],
      name: "demand_events_loop_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.principalId, table.loopId, table.ideaId],
      foreignColumns: [
        demandIdeas.principalId,
        demandIdeas.loopId,
        demandIdeas.id,
      ],
      name: "demand_events_idea_owner_fk",
    }).onDelete("cascade"),
    check(
      "demand_events_type_valid",
      sql`${table.type} in ('opened', 'saved', 'progress')`,
    ),
    check(
      "demand_events_key_valid",
      sql`char_length(${table.idempotencyKey}) between 8 and 128 and ${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`,
    ),
    check(
      "demand_events_data_valid",
      sql`jsonb_typeof(${table.data}) = 'object' and pg_column_size(${table.data}) <= 262144`,
    ),
  ],
);

/** Append-only provider accounting; one provider response can be billed once. */
export const demandUsage = privateSchema.table(
  "demand_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => demandPrincipals.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    stageId: uuid("stage_id").notNull(),
    responseId: text("response_id").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    searchCalls: integer("search_calls").notNull().default(0),
    costMicrousd: integer("cost_microusd"),
    pricingStatus: text("pricing_status")
      .$type<"priced" | "unpriced">()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("demand_usage_response_unique").on(table.responseId),
    index("demand_usage_principal_created_idx").on(
      table.principalId,
      table.createdAt,
    ),
    index("demand_usage_created_idx").on(table.createdAt),
    index("demand_usage_request_idx").on(table.requestId),
    foreignKey({
      columns: [table.principalId, table.requestId],
      foreignColumns: [demandRequests.principalId, demandRequests.id],
      name: "demand_usage_request_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.principalId, table.requestId, table.stageId],
      foreignColumns: [
        demandStages.principalId,
        demandStages.requestId,
        demandStages.id,
      ],
      name: "demand_usage_stage_owner_fk",
    }).onDelete("cascade"),
    check(
      "demand_usage_response_id_valid",
      sql`${table.responseId} = btrim(${table.responseId}) and char_length(${table.responseId}) between 1 and 200`,
    ),
    check(
      "demand_usage_model_valid",
      sql`${table.model} = btrim(${table.model}) and char_length(${table.model}) between 1 and 200`,
    ),
    check(
      "demand_usage_pricing_valid",
      sql`(
        (${table.pricingStatus} = 'priced' and ${table.costMicrousd} is not null)
        or
        (${table.pricingStatus} = 'unpriced' and ${table.costMicrousd} is null)
      )`,
    ),
    check("demand_usage_values_nonnegative", sql`
      ${table.inputTokens} >= 0 and
      ${table.cachedInputTokens} >= 0 and
      ${table.outputTokens} >= 0 and
      ${table.searchCalls} >= 0 and
      (${table.costMicrousd} is null or ${table.costMicrousd} >= 0)
    `),
  ],
);

// D34 audit/publication tables. SQL migrations additionally own forced RLS,
// exact role grants, immutable triggers and the anonymous projection function.
export const demandLoopEdits = privateSchema.table("demand_loop_edits", {
  id: uuid("id").primaryKey().defaultRandom(),
  principalId: uuid("principal_id").notNull().references(() => demandPrincipals.id, { onDelete: "restrict" }),
  loopId: uuid("loop_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  operation: text("operation").$type<"edit" | "archive">().notNull(),
  receipt: jsonb("receipt").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("demand_loop_edits_principal_key_unique").on(table.principalId, table.idempotencyKey),
  index("demand_loop_edits_loop_created_idx").on(table.principalId, table.loopId, table.createdAt),
  foreignKey({ name: "demand_loop_edits_owner_fk", columns: [table.principalId, table.loopId],
    foreignColumns: [demandLoops.principalId, demandLoops.id] }).onDelete("restrict"),
  check("demand_loop_edits_key_valid", sql`char_length(${table.idempotencyKey}) between 8 and 128 and ${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`),
  check("demand_loop_edits_fingerprint_valid", sql`${table.requestFingerprint} ~ '^[a-f0-9]{64}$'`),
  check("demand_loop_edits_operation_valid", sql`${table.operation} in ('edit','archive')`),
  check("demand_loop_edits_receipt_valid", sql`jsonb_typeof(${table.receipt}) = 'object' and pg_column_size(${table.receipt}) <= 262144`),
]);

export const demandPublicShares = privateSchema.table("demand_public_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  principalId: uuid("principal_id").notNull().references(() => demandPrincipals.id, { onDelete: "restrict" }),
  articleRequestId: uuid("article_request_id").notNull(),
  token: text("token").notNull().unique(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  snapshotFingerprint: text("snapshot_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  unique("demand_public_shares_article_unique").on(table.principalId, table.articleRequestId),
  unique("demand_public_shares_owner_id_unique").on(table.principalId, table.articleRequestId, table.id),
  index("demand_public_shares_principal_created_idx").on(table.principalId, table.createdAt),
  foreignKey({ name: "demand_public_shares_request_owner_fk", columns: [table.principalId, table.articleRequestId],
    foreignColumns: [demandRequests.principalId, demandRequests.id] }).onDelete("restrict"),
  check("demand_public_shares_token_check", sql`${table.token} ~ '^[0-9a-f]{64}$'`),
  check("demand_public_shares_snapshot_fingerprint_check", sql`${table.snapshotFingerprint} ~ '^[0-9a-f]{64}$'`),
  check("demand_public_shares_revocation_valid", sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`),
  check("demand_public_shares_snapshot_valid", sql`jsonb_typeof(${table.snapshot}) = 'object' and octet_length(${table.snapshot}::text) <= 262144
    and ${table.snapshot}->>'version' = '1'
    and ${table.snapshot} ?& array['version','title','deck','body','sources','sourceCount','basis','researchedAt','readingMinutes','publishedAt','correction']
    and ${table.snapshot} - array['version','title','deck','body','sources','sourceCount','basis','researchedAt','readingMinutes','publishedAt','correction'] = '{}'::jsonb
    and jsonb_typeof(${table.snapshot}->'body') = 'array' and jsonb_typeof(${table.snapshot}->'sources') = 'array'`),
]);

export const demandShareOperations = privateSchema.table("demand_share_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  principalId: uuid("principal_id").notNull(),
  articleRequestId: uuid("article_request_id").notNull(),
  shareId: uuid("share_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("demand_share_operations_key_unique").on(table.principalId, table.idempotencyKey),
  index("demand_share_operations_principal_created_idx").on(table.principalId, table.createdAt),
  foreignKey({ name: "demand_share_operations_share_owner_fk", columns: [table.principalId, table.articleRequestId, table.shareId],
    foreignColumns: [demandPublicShares.principalId, demandPublicShares.articleRequestId, demandPublicShares.id] }).onDelete("restrict"),
  check("demand_share_operations_idempotency_key_check", sql`char_length(${table.idempotencyKey}) between 8 and 128 and ${table.idempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`),
]);
