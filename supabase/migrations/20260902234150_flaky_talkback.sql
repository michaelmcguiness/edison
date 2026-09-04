CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
--> statement-breakpoint
CREATE SCHEMA "private";
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edison_api') THEN
		CREATE ROLE edison_api NOLOGIN NOINHERIT;
	END IF;
END
$$;
--> statement-breakpoint
GRANT edison_api TO postgres;
--> statement-breakpoint
CREATE TYPE "public"."article_length" AS ENUM('brief', 'standard', 'deep');--> statement-breakpoint
CREATE TYPE "public"."article_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."command_status" AS ENUM('queued', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."content_category" AS ENUM('for-you', 'tech-science', 'business', 'arts-culture', 'sports', 'entertainment');--> statement-breakpoint
CREATE TYPE "public"."generation_kind" AS ENUM('initial-edition', 'feed-replenishment', 'learning-thread', 'article-follow-up');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."interest_kind" AS ENUM('explicit', 'inferred', 'knowledge');--> statement-breakpoint
CREATE TABLE "alpha_memberships" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "alpha_memberships_status_valid" CHECK ("alpha_memberships"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "article_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_feedback" (
	"user_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"worth_your_time" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_feedback_user_id_article_id_pk" PRIMARY KEY("user_id","article_id")
);
--> statement-breakpoint
CREATE TABLE "article_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"citation_order" smallint NOT NULL,
	"title" text NOT NULL,
	"publisher" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cited_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "article_sources_order_positive" CHECK ("article_sources"."citation_order" > 0)
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"learning_thread_id" uuid,
	"slug" text NOT NULL,
	"status" "article_status" DEFAULT 'draft' NOT NULL,
	"category" "content_category" NOT NULL,
	"kicker" text NOT NULL,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"deck" text NOT NULL,
	"body" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"why_written" text NOT NULL,
	"reading_minutes" smallint NOT NULL,
	"source_count" smallint DEFAULT 0 NOT NULL,
	"researched_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_reading_minutes_positive" CHECK ("articles"."reading_minutes" > 0),
	CONSTRAINT "articles_source_count_nonnegative" CHECK ("articles"."source_count" >= 0),
	CONSTRAINT "articles_summary_three_items" CHECK (jsonb_array_length("articles"."summary") = 3)
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_role_valid" CHECK ("conversation_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "feed_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"command" text NOT NULL,
	"structured_update" jsonb,
	"status" "command_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"category" "content_category" NOT NULL,
	"edition_date" date NOT NULL,
	"rank" numeric(12, 6) NOT NULL,
	"reason" text NOT NULL,
	"served_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"article_length" "article_length" DEFAULT 'standard' NOT NULL,
	"depth" smallint DEFAULT 60 NOT NULL,
	"novelty" smallint DEFAULT 60 NOT NULL,
	"category_visibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inferred_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"knowledge_state" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_preferences_depth_range" CHECK ("feed_preferences"."depth" between 0 and 100),
	CONSTRAINT "feed_preferences_novelty_range" CHECK ("feed_preferences"."novelty" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "private"."generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "generation_kind" NOT NULL,
	"status" "generation_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workflow_run_id" text,
	"provider_response_id" text,
	"output_article_id" uuid,
	"model" text,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"failure_code" text,
	"error" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_attempt_nonnegative" CHECK ("private"."generation_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "learning_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_level" text DEFAULT 'beginner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"last_read_date" date,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_streak_nonnegative" CHECK ("profiles"."current_streak" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reading_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_articles" (
	"user_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_articles_user_id_article_id_pk" PRIMARY KEY("user_id","article_id")
);
--> statement-breakpoint
CREATE TABLE "private"."usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"generation_job_id" uuid,
	"operation" text NOT NULL,
	"provider" text DEFAULT 'openai' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"web_search_calls" smallint DEFAULT 0 NOT NULL,
	"cost_microusd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_ledger_tokens_nonnegative" CHECK (
      "private"."usage_ledger"."input_tokens" >= 0 and
      "private"."usage_ledger"."cached_input_tokens" >= 0 and
      "private"."usage_ledger"."output_tokens" >= 0 and
      "private"."usage_ledger"."web_search_calls" >= 0 and
      "private"."usage_ledger"."cost_microusd" >= 0
    )
);
--> statement-breakpoint
CREATE TABLE "user_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"kind" "interest_kind" DEFAULT 'explicit' NOT NULL,
	"weight" numeric(6, 3) DEFAULT '1' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_interests_status_valid" CHECK ("user_interests"."status" in ('active', 'muted', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "private"."webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alpha_memberships" ADD CONSTRAINT "alpha_memberships_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_memberships" ADD CONSTRAINT "alpha_memberships_invited_by_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_conversations" ADD CONSTRAINT "article_conversations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_conversations" ADD CONSTRAINT "article_conversations_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_feedback" ADD CONSTRAINT "article_feedback_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_feedback" ADD CONSTRAINT "article_feedback_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_shares" ADD CONSTRAINT "article_shares_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_shares" ADD CONSTRAINT "article_shares_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sources" ADD CONSTRAINT "article_sources_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_learning_thread_id_learning_threads_id_fk" FOREIGN KEY ("learning_thread_id") REFERENCES "public"."learning_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_article_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."article_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_commands" ADD CONSTRAINT "feed_commands_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_preferences" ADD CONSTRAINT "feed_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."generation_jobs" ADD CONSTRAINT "generation_jobs_output_article_id_articles_id_fk" FOREIGN KEY ("output_article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_threads" ADD CONSTRAINT "learning_threads_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_events" ADD CONSTRAINT "reading_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_events" ADD CONSTRAINT "reading_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_articles" ADD CONSTRAINT "saved_articles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_articles" ADD CONSTRAINT "saved_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ADD CONSTRAINT "usage_ledger_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "private"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_conversations_user_article_unique" ON "article_conversations" USING btree ("user_id","article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_shares_slug_unique" ON "article_shares" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "article_shares_user_article_unique" ON "article_shares" USING btree ("user_id","article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_sources_article_url_unique" ON "article_sources" USING btree ("article_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "article_sources_article_order_unique" ON "article_sources" USING btree ("article_id","citation_order");--> statement-breakpoint
CREATE INDEX "article_sources_article_idx" ON "article_sources" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_owner_slug_unique" ON "articles" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "articles_owner_status_created_idx" ON "articles" USING btree ("owner_id","status","created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_time_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_idempotency_unique" ON "conversation_messages" USING btree ("conversation_id","idempotency_key") WHERE "conversation_messages"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "feed_commands_user_created_idx" ON "feed_commands" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_items_user_article_unique" ON "feed_items" USING btree ("user_id","article_id");--> statement-breakpoint
CREATE INDEX "feed_items_user_category_rank_idx" ON "feed_items" USING btree ("user_id","category","edition_date","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_user_idempotency_unique" ON "private"."generation_jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_next_attempt_idx" ON "private"."generation_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_user_created_idx" ON "private"."generation_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_threads_user_slug_unique" ON "learning_threads" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "learning_threads_user_status_idx" ON "learning_threads" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_email_unique" ON "profiles" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_events_user_idempotency_unique" ON "reading_events" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "reading_events_user_time_idx" ON "reading_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "reading_events_article_idx" ON "reading_events" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "saved_articles_user_time_idx" ON "saved_articles" USING btree ("user_id","saved_at");--> statement-breakpoint
CREATE INDEX "usage_ledger_user_created_idx" ON "private"."usage_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_interests_user_topic_kind_unique" ON "user_interests" USING btree ("user_id","topic","kind");--> statement-breakpoint
CREATE INDEX "user_interests_user_status_idx" ON "user_interests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "private"."webhook_events" USING btree ("processed_at");
--> statement-breakpoint

-- Keep internal workflow state out of the Data API.
REVOKE ALL ON SCHEMA "private" FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA "private" TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA "private" TO service_role;

-- Edison tables are private until an explicit grant below says otherwise.
REVOKE ALL ON TABLE
  public.profiles,
  public.alpha_memberships,
  public.feed_preferences,
  public.user_interests,
  public.learning_threads,
  public.articles,
  public.article_sources,
  public.feed_items,
  public.reading_events,
  public.saved_articles,
  public.article_feedback,
  public.feed_commands,
  public.article_conversations,
  public.conversation_messages,
  public.article_shares
FROM anon, authenticated;

CREATE OR REPLACE FUNCTION "private"."touch_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_new_auth_user"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), '')
    )
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.feed_preferences (
    user_id,
    category_visibility,
    category_order
  )
  VALUES (
    NEW.id,
    '{"tech-science":true,"business":true,"arts-culture":true,"sports":true,"entertainment":true}'::jsonb,
    '["tech-science","business","arts-culture","sports","entertainment"]'::jsonb
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Public sign-ups are disabled. Every auth user is therefore created by an
  -- administrator/invitation and should receive alpha access automatically.
  INSERT INTO public.alpha_memberships (user_id, status)
  VALUES (NEW.id, 'active')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "on_auth_user_created" ON auth.users;
CREATE TRIGGER "on_auth_user_created"
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION "private"."handle_new_auth_user"();

CREATE TRIGGER "profiles_touch_updated_at"
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();
CREATE TRIGGER "feed_preferences_touch_updated_at"
BEFORE UPDATE ON public.feed_preferences
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();
CREATE TRIGGER "user_interests_touch_updated_at"
BEFORE UPDATE ON public.user_interests
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();
CREATE TRIGGER "learning_threads_touch_updated_at"
BEFORE UPDATE ON public.learning_threads
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();
CREATE TRIGGER "articles_touch_updated_at"
BEFORE UPDATE ON public.articles
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();
CREATE TRIGGER "feed_items_touch_updated_at"
BEFORE UPDATE ON public.feed_items
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();
CREATE TRIGGER "article_feedback_touch_updated_at"
BEFORE UPDATE ON public.article_feedback
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();
CREATE TRIGGER "feed_commands_touch_updated_at"
BEFORE UPDATE ON public.feed_commands
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();
CREATE TRIGGER "article_conversations_touch_updated_at"
BEFORE UPDATE ON public.article_conversations
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();
CREATE TRIGGER "generation_jobs_touch_updated_at"
BEFORE UPDATE ON private.generation_jobs
FOR EACH ROW EXECUTE FUNCTION "private"."touch_updated_at"();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alpha_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
ON public.profiles FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = id);
CREATE POLICY "profiles_update_own"
ON public.profiles FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY "alpha_memberships_select_own"
ON public.alpha_memberships FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "feed_preferences_select_own"
ON public.feed_preferences FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "feed_preferences_update_own"
ON public.feed_preferences FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "user_interests_select_own"
ON public.user_interests FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "user_interests_insert_own"
ON public.user_interests FOR INSERT TO edison_api
WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "user_interests_update_own"
ON public.user_interests FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "user_interests_delete_own"
ON public.user_interests FOR DELETE TO edison_api
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "learning_threads_select_own"
ON public.learning_threads FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "learning_threads_insert_own"
ON public.learning_threads FOR INSERT TO edison_api
WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "learning_threads_update_own"
ON public.learning_threads FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "articles_select_own"
ON public.articles FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "article_sources_select_owned_article"
ON public.article_sources FOR SELECT TO edison_api
USING (
  EXISTS (
    SELECT 1 FROM public.articles
    WHERE articles.id = article_sources.article_id
      AND articles.owner_id = (SELECT auth.uid())
  )
);

CREATE POLICY "feed_items_select_own"
ON public.feed_items FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "reading_events_select_own"
ON public.reading_events FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "reading_events_insert_own"
ON public.reading_events FOR INSERT TO edison_api
WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND EXISTS (
    SELECT 1 FROM public.articles
    WHERE articles.id = reading_events.article_id
      AND articles.owner_id = (SELECT auth.uid())
  )
);

CREATE POLICY "saved_articles_select_own"
ON public.saved_articles FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "saved_articles_insert_own"
ON public.saved_articles FOR INSERT TO edison_api
WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND EXISTS (
    SELECT 1 FROM public.articles
    WHERE articles.id = saved_articles.article_id
      AND articles.owner_id = (SELECT auth.uid())
  )
);
CREATE POLICY "saved_articles_delete_own"
ON public.saved_articles FOR DELETE TO edison_api
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "article_feedback_select_own"
ON public.article_feedback FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "article_feedback_insert_own"
ON public.article_feedback FOR INSERT TO edison_api
WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND EXISTS (
    SELECT 1 FROM public.articles
    WHERE articles.id = article_feedback.article_id
      AND articles.owner_id = (SELECT auth.uid())
  )
);
CREATE POLICY "article_feedback_update_own"
ON public.article_feedback FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "feed_commands_select_own"
ON public.feed_commands FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "feed_commands_insert_own"
ON public.feed_commands FOR INSERT TO edison_api
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "article_conversations_select_own"
ON public.article_conversations FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "article_conversations_insert_own"
ON public.article_conversations FOR INSERT TO edison_api
WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND EXISTS (
    SELECT 1 FROM public.articles
    WHERE articles.id = article_conversations.article_id
      AND articles.owner_id = (SELECT auth.uid())
  )
);
CREATE POLICY "article_conversations_update_own"
ON public.article_conversations FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "conversation_messages_select_own"
ON public.conversation_messages FOR SELECT TO edison_api
USING (
  EXISTS (
    SELECT 1 FROM public.article_conversations
    WHERE article_conversations.id = conversation_messages.conversation_id
      AND article_conversations.user_id = (SELECT auth.uid())
  )
);
CREATE POLICY "conversation_messages_insert_user"
ON public.conversation_messages FOR INSERT TO edison_api
WITH CHECK (
  role = 'user'
  AND EXISTS (
    SELECT 1 FROM public.article_conversations
    WHERE article_conversations.id = conversation_messages.conversation_id
      AND article_conversations.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "article_shares_select_own"
ON public.article_shares FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "article_shares_insert_own"
ON public.article_shares FOR INSERT TO edison_api
WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND EXISTS (
    SELECT 1 FROM public.articles
    WHERE articles.id = article_shares.article_id
      AND articles.owner_id = (SELECT auth.uid())
  )
);
CREATE POLICY "article_shares_update_own"
ON public.article_shares FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND EXISTS (
    SELECT 1 FROM public.articles
    WHERE articles.id = article_shares.article_id
      AND articles.owner_id = (SELECT auth.uid())
  )
);

-- Only the server may assume this non-login role. Supabase browser/mobile JWTs
-- remain useful for Auth, but cannot query Edison core tables through PostgREST.
GRANT USAGE ON SCHEMA public TO edison_api;
GRANT USAGE ON SCHEMA auth TO edison_api;
GRANT EXECUTE ON FUNCTION auth.uid() TO edison_api;
GRANT SELECT ON public.profiles TO edison_api;
GRANT UPDATE (
  display_name,
  onboarding_complete,
  timezone,
  current_streak,
  last_read_date
) ON public.profiles TO edison_api;
GRANT SELECT ON public.alpha_memberships TO edison_api;
GRANT SELECT, UPDATE ON public.feed_preferences TO edison_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_interests TO edison_api;
GRANT SELECT, INSERT, UPDATE ON public.learning_threads TO edison_api;
GRANT SELECT ON public.articles, public.article_sources, public.feed_items TO edison_api;
GRANT SELECT, INSERT ON public.reading_events TO edison_api;
GRANT SELECT, INSERT, DELETE ON public.saved_articles TO edison_api;
GRANT SELECT, INSERT, UPDATE ON public.article_feedback TO edison_api;
GRANT SELECT, INSERT ON public.feed_commands TO edison_api;
GRANT SELECT, INSERT, UPDATE ON public.article_conversations TO edison_api;
GRANT SELECT, INSERT ON public.conversation_messages TO edison_api;
GRANT SELECT, INSERT ON public.article_shares TO edison_api;
GRANT UPDATE (slug, snapshot, revoked_at, created_at) ON public.article_shares TO edison_api;

-- Reserve a private bucket for future generated article assets. It has no
-- client policies during alpha; uploads must wait for an active-member,
-- server-signed flow so revoked Auth users cannot create storage cost.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('article-assets', 'article-assets', false, 10485760)
ON CONFLICT (id) DO NOTHING;
