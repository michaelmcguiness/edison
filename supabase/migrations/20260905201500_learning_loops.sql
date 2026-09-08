ALTER TABLE public.learning_threads
  ADD COLUMN normalized_title text,
  ADD COLUMN original_curiosity text,
  ADD COLUMN direction text NOT NULL DEFAULT '',
  ADD COLUMN revision integer NOT NULL DEFAULT 0,
  ADD COLUMN creation_idempotency_key text,
  ADD COLUMN creation_request_fingerprint text;

UPDATE public.learning_threads
SET
  normalized_title = lower(
    regexp_replace(btrim(title), '[[:space:]]+', ' ', 'g')
  ),
  original_curiosity = coalesce(nullif(btrim(summary), ''), btrim(title)),
  creation_idempotency_key = 'legacy:' || id::text,
  creation_request_fingerprint = repeat('0', 64);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.learning_threads
    WHERE char_length(btrim(title)) NOT BETWEEN 1 AND 120
      OR char_length(btrim(original_curiosity)) NOT BETWEEN 1 AND 500
      OR status NOT IN ('active', 'paused', 'archived')
  ) THEN
    RAISE EXCEPTION 'existing learning threads cannot satisfy the loop contract'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.learning_threads
    GROUP BY user_id, normalized_title
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'existing learning threads contain duplicate normalized titles'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.learning_threads
    WHERE status IN ('active', 'paused')
    GROUP BY user_id
    HAVING count(*) > 30
  ) THEN
    RAISE EXCEPTION 'an existing reader retains more than 30 learning loops'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.articles AS article
    JOIN public.learning_threads AS loop
      ON loop.id = article.learning_thread_id
    WHERE article.owner_id <> loop.user_id
  ) THEN
    RAISE EXCEPTION 'an existing article references another reader learning loop'
      USING ERRCODE = '23503';
  END IF;
END
$$;

ALTER TABLE public.learning_threads
  ALTER COLUMN normalized_title SET NOT NULL,
  ALTER COLUMN original_curiosity SET NOT NULL,
  ALTER COLUMN creation_idempotency_key SET NOT NULL,
  ALTER COLUMN creation_request_fingerprint SET NOT NULL,
  ALTER COLUMN current_level SET DEFAULT 'unspecified',
  ADD CONSTRAINT learning_threads_title_length
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  ADD CONSTRAINT learning_threads_normalized_title_valid
    CHECK (
      char_length(normalized_title) BETWEEN 1 AND 120
      AND normalized_title = lower(
        regexp_replace(btrim(normalized_title), '[[:space:]]+', ' ', 'g')
      )
    ),
  ADD CONSTRAINT learning_threads_original_curiosity_length
    CHECK (char_length(btrim(original_curiosity)) BETWEEN 1 AND 500),
  ADD CONSTRAINT learning_threads_direction_length
    CHECK (direction = btrim(direction) AND char_length(direction) <= 1000),
  ADD CONSTRAINT learning_threads_revision_nonnegative
    CHECK (revision >= 0),
  ADD CONSTRAINT learning_threads_status_valid
    CHECK (status IN ('active', 'paused', 'archived')),
  ADD CONSTRAINT learning_threads_creation_key_valid
    CHECK (
      char_length(creation_idempotency_key) BETWEEN 8 AND 128
      AND creation_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    ),
  ADD CONSTRAINT learning_threads_creation_fingerprint_length
    CHECK (char_length(creation_request_fingerprint) = 64);

CREATE UNIQUE INDEX learning_threads_id_user_unique
ON public.learning_threads (id, user_id);

CREATE UNIQUE INDEX learning_threads_user_normalized_title_unique
ON public.learning_threads (user_id, normalized_title);

CREATE UNIQUE INDEX learning_threads_user_creation_key_unique
ON public.learning_threads (user_id, creation_idempotency_key);

ALTER TABLE public.articles
  ADD CONSTRAINT articles_learning_loop_owner_fk
  FOREIGN KEY (learning_thread_id, owner_id)
  REFERENCES public.learning_threads(id, user_id);

CREATE OR REPLACE FUNCTION private.enforce_learning_loop_retained_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  retained_count integer;
BEGIN
  IF NEW.status NOT IN ('active', 'paused') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('active', 'paused') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('edison-learning-loops:' || NEW.user_id::text, 0)
  );
  SELECT count(*)::integer
  INTO retained_count
  FROM public.learning_threads AS loop
  WHERE loop.user_id = NEW.user_id
    AND loop.status IN ('active', 'paused');

  IF retained_count >= 30 THEN
    RAISE EXCEPTION 'a reader can retain at most 30 learning loops'
      USING ERRCODE = '23514',
        CONSTRAINT = 'learning_threads_retained_limit';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_learning_loop_retained_limit()
FROM PUBLIC;

CREATE TRIGGER learning_threads_enforce_retained_limit
BEFORE INSERT OR UPDATE OF status ON public.learning_threads
FOR EACH ROW EXECUTE FUNCTION private.enforce_learning_loop_retained_limit();

CREATE TABLE public.learning_loop_direction_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation text NOT NULL,
  base_revision integer NOT NULL,
  resulting_revision integer NOT NULL,
  before_direction text NOT NULL,
  after_direction text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  undo_of_mutation_id uuid REFERENCES public.learning_loop_direction_mutations(id)
    ON DELETE CASCADE,
  reverted_by_mutation_id uuid REFERENCES public.learning_loop_direction_mutations(id)
    ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT learning_loop_direction_mutations_loop_owner_fk
    FOREIGN KEY (loop_id, user_id)
    REFERENCES public.learning_threads(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT learning_loop_direction_mutations_operation_valid
    CHECK (operation IN ('set', 'undo')),
  CONSTRAINT learning_loop_direction_mutations_revision_step
    CHECK (
      base_revision >= 0
      AND resulting_revision = base_revision + 1
    ),
  CONSTRAINT learning_loop_direction_mutations_direction_length
    CHECK (
      before_direction = btrim(before_direction)
      AND after_direction = btrim(after_direction)
      AND char_length(before_direction) <= 1000
      AND char_length(after_direction) <= 1000
    ),
  CONSTRAINT learning_loop_direction_mutations_key_valid
    CHECK (
      char_length(idempotency_key) BETWEEN 8 AND 128
      AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    ),
  CONSTRAINT learning_loop_direction_mutations_fingerprint_length
    CHECK (char_length(request_fingerprint) = 64),
  CONSTRAINT learning_loop_direction_mutations_undo_consistent
    CHECK ((operation = 'undo') = (undo_of_mutation_id IS NOT NULL))
);

CREATE UNIQUE INDEX learning_loop_direction_mutations_user_key_unique
ON public.learning_loop_direction_mutations (user_id, idempotency_key);

CREATE UNIQUE INDEX learning_loop_direction_mutations_undo_once_unique
ON public.learning_loop_direction_mutations (undo_of_mutation_id);

CREATE INDEX learning_loop_direction_mutations_reverted_by_idx
ON public.learning_loop_direction_mutations (reverted_by_mutation_id);

CREATE UNIQUE INDEX learning_loop_direction_mutations_loop_revision_unique
ON public.learning_loop_direction_mutations (loop_id, resulting_revision);

CREATE OR REPLACE FUNCTION private.validate_learning_loop_direction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  current_loop public.learning_threads%ROWTYPE;
  source_mutation public.learning_loop_direction_mutations%ROWTYPE;
BEGIN
  SELECT loop.*
  INTO current_loop
  FROM public.learning_threads AS loop
  WHERE loop.id = NEW.loop_id
    AND loop.user_id = NEW.user_id;

  IF NOT FOUND
    OR current_loop.status NOT IN ('active', 'paused')
    OR current_loop.revision <> NEW.base_revision
    OR current_loop.direction <> NEW.before_direction
  THEN
    RAISE EXCEPTION 'a loop direction mutation must begin at the current revision'
      USING ERRCODE = '23514',
        CONSTRAINT = 'learning_loop_direction_mutations_current_revision';
  END IF;

  IF NEW.operation = 'undo' THEN
    SELECT mutation.*
    INTO source_mutation
    FROM public.learning_loop_direction_mutations AS mutation
    WHERE mutation.id = NEW.undo_of_mutation_id
      AND mutation.loop_id = NEW.loop_id
      AND mutation.user_id = NEW.user_id
      AND mutation.operation = 'set';

    IF NOT FOUND
      OR source_mutation.reverted_by_mutation_id IS NOT NULL
      OR source_mutation.resulting_revision <> NEW.base_revision
      OR source_mutation.after_direction <> NEW.before_direction
      OR source_mutation.before_direction <> NEW.after_direction
    THEN
      RAISE EXCEPTION 'an undo must exactly reverse the current loop mutation'
        USING ERRCODE = '23514',
          CONSTRAINT = 'learning_loop_direction_mutations_undo_exact';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_learning_loop_direction_mutation()
FROM PUBLIC;

CREATE TRIGGER learning_loop_direction_mutations_validate
BEFORE INSERT ON public.learning_loop_direction_mutations
FOR EACH ROW EXECUTE FUNCTION private.validate_learning_loop_direction_mutation();

CREATE TABLE public.learning_loop_public_articles (
  loop_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  public_article_id uuid NOT NULL
    REFERENCES public.public_starter_edition_articles(id) ON DELETE RESTRICT,
  position smallint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT learning_loop_public_articles_pk
    PRIMARY KEY (loop_id, public_article_id),
  CONSTRAINT learning_loop_public_articles_loop_owner_fk
    FOREIGN KEY (loop_id, user_id)
    REFERENCES public.learning_threads(id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT learning_loop_public_articles_position_bounded
    CHECK (position BETWEEN 1 AND 30)
);

CREATE UNIQUE INDEX learning_loop_public_articles_position_unique
ON public.learning_loop_public_articles (loop_id, position);

CREATE INDEX learning_loop_public_articles_user_idx
ON public.learning_loop_public_articles (user_id, loop_id);

CREATE INDEX learning_loop_public_articles_article_idx
ON public.learning_loop_public_articles (public_article_id);

CREATE TRIGGER learning_loop_direction_mutations_touch_updated_at
BEFORE UPDATE ON public.learning_loop_direction_mutations
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE OR REPLACE FUNCTION private.protect_learning_loop_identity_and_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.normalized_title IS DISTINCT FROM OLD.normalized_title
    OR NEW.original_curiosity IS DISTINCT FROM OLD.original_curiosity
    OR NEW.creation_idempotency_key IS DISTINCT FROM OLD.creation_idempotency_key
    OR NEW.creation_request_fingerprint IS DISTINCT FROM OLD.creation_request_fingerprint
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'learning loop identity and original curiosity are immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'learning_threads_identity_immutable';
  END IF;

  IF NEW.direction IS DISTINCT FROM OLD.direction
    OR NEW.revision IS DISTINCT FROM OLD.revision
  THEN
    IF NEW.revision <> OLD.revision + 1 OR NOT EXISTS (
      SELECT 1
      FROM public.learning_loop_direction_mutations AS mutation
      WHERE mutation.loop_id = OLD.id
        AND mutation.user_id = OLD.user_id
        AND mutation.base_revision = OLD.revision
        AND mutation.resulting_revision = NEW.revision
        AND mutation.before_direction = OLD.direction
        AND mutation.after_direction = NEW.direction
    ) THEN
      RAISE EXCEPTION 'learning loop direction changes require matching history'
        USING ERRCODE = '23514',
          CONSTRAINT = 'learning_threads_direction_history_required';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_learning_loop_identity_and_revision()
FROM PUBLIC;

CREATE TRIGGER learning_threads_protect_loop_identity_and_revision
BEFORE UPDATE ON public.learning_threads
FOR EACH ROW EXECUTE FUNCTION private.protect_learning_loop_identity_and_revision();

CREATE OR REPLACE FUNCTION private.protect_learning_loop_mutation_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.loop_id IS DISTINCT FROM OLD.loop_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.base_revision IS DISTINCT FROM OLD.base_revision
    OR NEW.resulting_revision IS DISTINCT FROM OLD.resulting_revision
    OR NEW.before_direction IS DISTINCT FROM OLD.before_direction
    OR NEW.after_direction IS DISTINCT FROM OLD.after_direction
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.undo_of_mutation_id IS DISTINCT FROM OLD.undo_of_mutation_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'learning loop direction history is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'learning_loop_direction_mutations_immutable';
  END IF;

  IF NEW.reverted_by_mutation_id IS DISTINCT FROM OLD.reverted_by_mutation_id
    AND (
      OLD.operation <> 'set'
      OR OLD.reverted_by_mutation_id IS NOT NULL
      OR NEW.reverted_by_mutation_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.learning_loop_direction_mutations AS undo_mutation
        WHERE undo_mutation.id = NEW.reverted_by_mutation_id
          AND undo_mutation.loop_id = OLD.loop_id
          AND undo_mutation.user_id = OLD.user_id
          AND undo_mutation.operation = 'undo'
          AND undo_mutation.undo_of_mutation_id = OLD.id
      )
    )
  THEN
    RAISE EXCEPTION 'learning loop mutation reversal is invalid'
      USING ERRCODE = '23514',
        CONSTRAINT = 'learning_loop_direction_mutations_reversal_valid';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_learning_loop_mutation_history()
FROM PUBLIC;

CREATE TRIGGER learning_loop_direction_mutations_protect_history
BEFORE UPDATE ON public.learning_loop_direction_mutations
FOR EACH ROW EXECUTE FUNCTION private.protect_learning_loop_mutation_history();

CREATE OR REPLACE FUNCTION private.enforce_learning_loop_public_article_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.public_starter_edition_articles AS item
    JOIN public.public_starter_editions AS edition
      ON edition.id = item.edition_id
    WHERE item.id = NEW.public_article_id
      AND edition.status = 'published'
      AND edition.published_at <= now()
  ) THEN
    RAISE EXCEPTION 'public loop articles must already be published'
      USING ERRCODE = '23514',
        CONSTRAINT = 'learning_loop_public_articles_published';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_learning_loop_public_article_eligibility()
FROM PUBLIC;

CREATE TRIGGER learning_loop_public_articles_require_published
BEFORE INSERT ON public.learning_loop_public_articles
FOR EACH ROW EXECUTE FUNCTION private.enforce_learning_loop_public_article_eligibility();

CREATE OR REPLACE FUNCTION private.enforce_article_learning_loop_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.learning_thread_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.learning_threads AS loop
    WHERE loop.id = NEW.learning_thread_id
      AND loop.user_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'an article learning loop must belong to its owner'
      USING ERRCODE = '23503',
        CONSTRAINT = 'articles_learning_loop_owner_fk';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_article_learning_loop_owner()
FROM PUBLIC;

CREATE TRIGGER articles_enforce_learning_loop_owner
BEFORE INSERT OR UPDATE OF owner_id, learning_thread_id ON public.articles
FOR EACH ROW EXECUTE FUNCTION private.enforce_article_learning_loop_owner();

CREATE INDEX articles_learning_thread_idx
ON public.articles (learning_thread_id);

ALTER TABLE public.learning_loop_direction_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_loop_public_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY learning_loop_direction_mutations_select_own
ON public.learning_loop_direction_mutations FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY learning_loop_direction_mutations_insert_own
ON public.learning_loop_direction_mutations FOR INSERT TO edison_api
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY learning_loop_direction_mutations_update_own
ON public.learning_loop_direction_mutations FOR UPDATE TO edison_api
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY learning_loop_public_articles_select_own
ON public.learning_loop_public_articles FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY learning_loop_public_articles_insert_own
ON public.learning_loop_public_articles FOR INSERT TO edison_api
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY public_starter_editions_read_for_learning_loops
ON public.public_starter_editions FOR SELECT TO edison_api
USING (status IN ('published', 'archived') AND published_at <= now());

CREATE POLICY public_starter_articles_read_for_learning_loops
ON public.public_starter_edition_articles FOR SELECT TO edison_api
USING (
  EXISTS (
    SELECT 1
    FROM public.public_starter_editions AS edition
    WHERE edition.id = public_starter_edition_articles.edition_id
      AND edition.status IN ('published', 'archived')
      AND edition.published_at <= now()
  )
);

REVOKE ALL ON TABLE
  public.learning_loop_direction_mutations,
  public.learning_loop_public_articles
FROM PUBLIC, anon, authenticated;

REVOKE UPDATE ON public.learning_threads FROM edison_api;
GRANT UPDATE (direction, revision, status, updated_at)
ON public.learning_threads TO edison_api;
GRANT SELECT, INSERT ON public.learning_loop_direction_mutations TO edison_api;
GRANT UPDATE (reverted_by_mutation_id, updated_at)
ON public.learning_loop_direction_mutations TO edison_api;
GRANT SELECT, INSERT ON public.learning_loop_public_articles TO edison_api;
GRANT SELECT ON
  public.public_starter_editions,
  public.public_starter_edition_articles
TO edison_api;
