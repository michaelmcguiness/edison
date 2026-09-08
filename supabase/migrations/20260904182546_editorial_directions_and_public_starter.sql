CREATE TYPE "public"."editorial_direction_operation" AS ENUM('create', 'update', 'delete', 'undo');--> statement-breakpoint
CREATE TYPE "public"."editorial_direction_scope" AS ENUM('persistent', 'edition');--> statement-breakpoint
CREATE TYPE "public"."publication_section" AS ENUM('news', 'books', 'podcasts');--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edison_public') THEN
		CREATE ROLE edison_public NOLOGIN NOINHERIT;
	END IF;
END
$$;
--> statement-breakpoint
GRANT edison_public TO postgres;
--> statement-breakpoint
CREATE TABLE "editorial_direction_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"section" "publication_section" NOT NULL,
	"operation" "editorial_direction_operation" NOT NULL,
	"instruction_id" uuid NOT NULL,
	"base_revision" integer NOT NULL,
	"resulting_revision" integer NOT NULL,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"undo_of_mutation_id" uuid,
	"reverted_by_mutation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editorial_direction_mutations_revision_step" CHECK ("editorial_direction_mutations"."base_revision" >= 0 and "editorial_direction_mutations"."resulting_revision" = "editorial_direction_mutations"."base_revision" + 1),
	CONSTRAINT "editorial_direction_mutations_fingerprint_length" CHECK (char_length("editorial_direction_mutations"."request_fingerprint") = 64),
	CONSTRAINT "editorial_direction_mutations_idempotency_key_valid" CHECK (char_length("editorial_direction_mutations"."idempotency_key") between 8 and 128 and "editorial_direction_mutations"."idempotency_key" ~ '^[A-Za-z0-9._:-]+$'),
	CONSTRAINT "editorial_direction_mutations_snapshot_consistent" CHECK (
        jsonb_typeof("editorial_direction_mutations"."after_snapshot") = 'object'
        and (
          ("editorial_direction_mutations"."operation" = 'create' and "editorial_direction_mutations"."before_snapshot" is null)
          or
          ("editorial_direction_mutations"."operation" <> 'create' and jsonb_typeof("editorial_direction_mutations"."before_snapshot") = 'object')
        )
      ),
	CONSTRAINT "editorial_direction_mutations_undo_consistent" CHECK (("editorial_direction_mutations"."operation" = 'undo') = ("editorial_direction_mutations"."undo_of_mutation_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "editorial_direction_states" (
	"user_id" uuid NOT NULL,
	"section" "publication_section" NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"current_edition_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editorial_direction_states_user_id_section_pk" PRIMARY KEY("user_id","section"),
	CONSTRAINT "editorial_direction_states_revision_nonnegative" CHECK ("editorial_direction_states"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "editorial_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"section" "publication_section" NOT NULL,
	"scope" "editorial_direction_scope" NOT NULL,
	"edition_id" uuid,
	"text" text NOT NULL,
	"revision" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editorial_instructions_scope_edition_consistent" CHECK ((
        ("editorial_instructions"."scope" = 'persistent' and "editorial_instructions"."edition_id" is null)
        or
        ("editorial_instructions"."scope" = 'edition' and "editorial_instructions"."edition_id" is not null)
      )),
	CONSTRAINT "editorial_instructions_text_length" CHECK (char_length(btrim("editorial_instructions"."text")) between 3 and 1000),
	CONSTRAINT "editorial_instructions_revision_positive" CHECK ("editorial_instructions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "public_starter_edition_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_starter_edition_articles_position_positive" CHECK ("public_starter_edition_articles"."position" > 0),
	CONSTRAINT "public_starter_edition_articles_reason_length" CHECK (char_length(btrim("public_starter_edition_articles"."reason")) between 1 and 500),
	CONSTRAINT "public_starter_edition_articles_snapshot_object" CHECK (jsonb_typeof("public_starter_edition_articles"."snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "public_starter_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section" "publication_section" NOT NULL,
	"edition_date" date NOT NULL,
	"label" text DEFAULT 'A place to begin' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_starter_editions_status_valid" CHECK ("public_starter_editions"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "public_starter_editions_publication_consistent" CHECK ((
        ("public_starter_editions"."status" = 'draft' and "public_starter_editions"."published_at" is null)
        or
        ("public_starter_editions"."status" in ('published', 'archived') and "public_starter_editions"."published_at" is not null)
      )),
	CONSTRAINT "public_starter_editions_label_length" CHECK (char_length(btrim("public_starter_editions"."label")) between 1 and 120),
	CONSTRAINT "public_starter_editions_fingerprint_length" CHECK (char_length("public_starter_editions"."request_fingerprint") = 64),
	CONSTRAINT "public_starter_editions_idempotency_key_valid" CHECK (char_length("public_starter_editions"."idempotency_key") between 8 and 128 and "public_starter_editions"."idempotency_key" ~ '^[A-Za-z0-9._:-]+$')
);
--> statement-breakpoint
ALTER TABLE "editorial_direction_mutations" ADD CONSTRAINT "editorial_direction_mutations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_direction_mutations" ADD CONSTRAINT "editorial_direction_mutations_instruction_id_editorial_instructions_id_fk" FOREIGN KEY ("instruction_id") REFERENCES "public"."editorial_instructions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_direction_mutations" ADD CONSTRAINT "editorial_direction_mutations_undo_of_mutation_id_editorial_direction_mutations_id_fk" FOREIGN KEY ("undo_of_mutation_id") REFERENCES "public"."editorial_direction_mutations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_direction_mutations" ADD CONSTRAINT "editorial_direction_mutations_reverted_by_mutation_id_editorial_direction_mutations_id_fk" FOREIGN KEY ("reverted_by_mutation_id") REFERENCES "public"."editorial_direction_mutations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_direction_mutations" ADD CONSTRAINT "editorial_direction_mutations_state_fk" FOREIGN KEY ("user_id","section") REFERENCES "public"."editorial_direction_states"("user_id","section") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_direction_states" ADD CONSTRAINT "editorial_direction_states_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_instructions" ADD CONSTRAINT "editorial_instructions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_instructions" ADD CONSTRAINT "editorial_instructions_state_fk" FOREIGN KEY ("user_id","section") REFERENCES "public"."editorial_direction_states"("user_id","section") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_starter_edition_articles" ADD CONSTRAINT "public_starter_edition_articles_edition_id_public_starter_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."public_starter_editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_direction_mutations_user_idempotency_unique" ON "editorial_direction_mutations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_direction_mutations_undo_once_unique" ON "editorial_direction_mutations" USING btree ("undo_of_mutation_id") WHERE "editorial_direction_mutations"."undo_of_mutation_id" is not null;--> statement-breakpoint
CREATE INDEX "editorial_direction_mutations_user_section_revision_idx" ON "editorial_direction_mutations" USING btree ("user_id","section","resulting_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_direction_states_edition_unique" ON "editorial_direction_states" USING btree ("current_edition_id");--> statement-breakpoint
CREATE INDEX "editorial_instructions_user_section_idx" ON "editorial_instructions" USING btree ("user_id","section","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "public_starter_edition_articles_position_unique" ON "public_starter_edition_articles" USING btree ("edition_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "public_starter_editions_section_date_unique" ON "public_starter_editions" USING btree ("section","edition_date");--> statement-breakpoint
CREATE UNIQUE INDEX "public_starter_editions_idempotency_unique" ON "public_starter_editions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "public_starter_editions_current_idx" ON "public_starter_editions" USING btree ("section","status","published_at");
--> statement-breakpoint
INSERT INTO public.editorial_direction_states (user_id, section)
SELECT profiles.id, section.value::public.publication_section
FROM public.profiles
CROSS JOIN (
	VALUES ('news'), ('books'), ('podcasts')
) AS section(value)
ON CONFLICT (user_id, section) DO NOTHING;
--> statement-breakpoint
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

	INSERT INTO public.alpha_memberships (user_id, status)
	VALUES (NEW.id, 'active')
	ON CONFLICT (user_id) DO NOTHING;

	INSERT INTO public.editorial_direction_states (user_id, section)
	VALUES
		(NEW.id, 'news'),
		(NEW.id, 'books'),
		(NEW.id, 'podcasts')
	ON CONFLICT (user_id, section) DO NOTHING;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "editorial_direction_states_touch_updated_at"
BEFORE UPDATE ON public.editorial_direction_states
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER "editorial_instructions_touch_updated_at"
BEFORE UPDATE ON public.editorial_instructions
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER "editorial_direction_mutations_touch_updated_at"
BEFORE UPDATE ON public.editorial_direction_mutations
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER "public_starter_editions_touch_updated_at"
BEFORE UPDATE ON public.public_starter_editions
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.protect_public_starter_edition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
	IF TG_OP = 'DELETE' AND OLD.published_at IS NOT NULL THEN
		RAISE EXCEPTION 'published starter editions are immutable';
	END IF;

	IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL THEN
		IF NEW.id IS DISTINCT FROM OLD.id
			OR NEW.section IS DISTINCT FROM OLD.section
			OR NEW.edition_date IS DISTINCT FROM OLD.edition_date
			OR NEW.label IS DISTINCT FROM OLD.label
			OR NEW.published_at IS DISTINCT FROM OLD.published_at
			OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
			OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
			OR NOT (OLD.status = 'published' AND NEW.status = 'archived')
		THEN
			RAISE EXCEPTION 'published starter editions are immutable';
		END IF;
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE')
		AND NEW.status = 'published'
		AND NOT EXISTS (
			SELECT 1
			FROM public.public_starter_edition_articles item
			WHERE item.edition_id = NEW.id
		)
	THEN
		RAISE EXCEPTION 'a starter edition must contain an article before publication';
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "public_starter_editions_protect_published"
BEFORE INSERT OR UPDATE OR DELETE ON public.public_starter_editions
FOR EACH ROW EXECUTE FUNCTION private.protect_public_starter_edition();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.protect_public_starter_article()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
	target_edition_id uuid;
BEGIN
	target_edition_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.edition_id ELSE NEW.edition_id END;
	IF EXISTS (
		SELECT 1
		FROM public.public_starter_editions edition
		WHERE edition.id = target_edition_id
			AND edition.published_at IS NOT NULL
	) THEN
		RAISE EXCEPTION 'articles in a published starter edition are immutable';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "public_starter_edition_articles_protect_published"
BEFORE INSERT OR UPDATE OR DELETE ON public.public_starter_edition_articles
FOR EACH ROW EXECUTE FUNCTION private.protect_public_starter_article();
--> statement-breakpoint
ALTER TABLE public.editorial_direction_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_direction_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_starter_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_starter_edition_articles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "editorial_direction_states_select_own"
ON public.editorial_direction_states FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "editorial_direction_states_update_own"
ON public.editorial_direction_states FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "editorial_instructions_select_own"
ON public.editorial_instructions FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "editorial_instructions_insert_own"
ON public.editorial_instructions FOR INSERT TO edison_api
WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "editorial_instructions_update_own"
ON public.editorial_instructions FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "editorial_direction_mutations_select_own"
ON public.editorial_direction_mutations FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "editorial_direction_mutations_insert_own"
ON public.editorial_direction_mutations FOR INSERT TO edison_api
WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "editorial_direction_mutations_update_own"
ON public.editorial_direction_mutations FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "public_starter_editions_read_published"
ON public.public_starter_editions FOR SELECT TO edison_public
USING (status = 'published' AND published_at <= now());
CREATE POLICY "public_starter_edition_articles_read_published"
ON public.public_starter_edition_articles FOR SELECT TO edison_public
USING (
	EXISTS (
		SELECT 1
		FROM public.public_starter_editions edition
		WHERE edition.id = public_starter_edition_articles.edition_id
			AND edition.status = 'published'
			AND edition.published_at <= now()
	)
);
--> statement-breakpoint
REVOKE ALL ON TABLE
	public.editorial_direction_states,
	public.editorial_instructions,
	public.editorial_direction_mutations,
	public.public_starter_editions,
	public.public_starter_edition_articles
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO edison_public;
GRANT SELECT ON public.public_starter_editions, public.public_starter_edition_articles
TO edison_public;
--> statement-breakpoint
GRANT SELECT ON public.editorial_direction_states TO edison_api;
GRANT UPDATE (revision, updated_at) ON public.editorial_direction_states TO edison_api;
GRANT SELECT, INSERT ON public.editorial_instructions TO edison_api;
GRANT UPDATE (scope, edition_id, text, revision, deleted_at, updated_at)
ON public.editorial_instructions TO edison_api;
GRANT SELECT, INSERT ON public.editorial_direction_mutations TO edison_api;
GRANT UPDATE (reverted_by_mutation_id, updated_at)
ON public.editorial_direction_mutations TO edison_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
ON public.public_starter_editions, public.public_starter_edition_articles
TO service_role;
