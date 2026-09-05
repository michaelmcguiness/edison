CREATE TABLE private.article_correction_audits (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  article_id uuid NOT NULL
    REFERENCES public.articles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  original_artifact_sha256 text NOT NULL,
  corrected_artifact_sha256 text NOT NULL,
  expected_original_fingerprint text NOT NULL,
  corrected_fingerprint text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  corrected_by text NOT NULL,
  correction_note text NOT NULL,
  corrected_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT article_correction_audits_idempotency_key_valid
    CHECK (
      char_length(idempotency_key) BETWEEN 8 AND 128
      AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    ),
  CONSTRAINT article_correction_audits_hashes_valid
    CHECK (
      request_fingerprint ~ '^[0-9a-f]{64}$'
      AND original_artifact_sha256 ~ '^[0-9a-f]{64}$'
      AND corrected_artifact_sha256 ~ '^[0-9a-f]{64}$'
      AND expected_original_fingerprint ~ '^[0-9a-f]{64}$'
      AND corrected_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT article_correction_audits_snapshots_are_objects
    CHECK (
      jsonb_typeof(before_snapshot) = 'object'
      AND jsonb_typeof(after_snapshot) = 'object'
    ),
  CONSTRAINT article_correction_audits_snapshots_differ
    CHECK (before_snapshot IS DISTINCT FROM after_snapshot),
  CONSTRAINT article_correction_audits_actor_valid
    CHECK (
      corrected_by = btrim(corrected_by)
      AND char_length(corrected_by) BETWEEN 1 AND 100
    ),
  CONSTRAINT article_correction_audits_note_valid
    CHECK (
      correction_note = btrim(correction_note)
      AND char_length(correction_note) BETWEEN 1 AND 500
    )
);

CREATE UNIQUE INDEX article_correction_audits_owner_key_unique
ON private.article_correction_audits (owner_id, idempotency_key);

CREATE INDEX article_correction_audits_article_time_idx
ON private.article_correction_audits (article_id, corrected_at DESC);

ALTER TABLE private.article_correction_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.article_correction_audits FORCE ROW LEVEL SECURITY;

-- No application role can read or mutate the full before/after snapshots.
REVOKE ALL ON TABLE private.article_correction_audits FROM PUBLIC;
REVOKE ALL ON TABLE private.article_correction_audits FROM anon;
REVOKE ALL ON TABLE private.article_correction_audits FROM authenticated;
REVOKE ALL ON TABLE private.article_correction_audits FROM edison_api;
REVOKE ALL ON TABLE private.article_correction_audits FROM edison_public;
REVOKE ALL ON TABLE private.article_correction_audits FROM service_role;

CREATE OR REPLACE FUNCTION private.article_correction_snapshot_fingerprint(
  snapshot jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

REVOKE ALL ON FUNCTION private.article_correction_snapshot_fingerprint(jsonb)
FROM PUBLIC;

-- Audit rows cannot be changed while their source article exists. A cascade
-- from deleting the source article may remove them so account erasure is not
-- blocked by an otherwise immutable operational record.
CREATE OR REPLACE FUNCTION private.protect_article_correction_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.articles AS article
      WHERE article.id = NEW.article_id
        AND article.owner_id = NEW.owner_id
    ) THEN
      RAISE EXCEPTION 'article correction owner must match the article owner'
        USING ERRCODE = '23503',
          CONSTRAINT = 'article_correction_audits_article_owner_fk';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' OR EXISTS (
    SELECT 1
    FROM public.articles AS article
    WHERE article.id = OLD.article_id
  ) THEN
    RAISE EXCEPTION 'article correction audit history is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'article_correction_audits_immutable';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_article_correction_audit()
FROM PUBLIC;

CREATE TRIGGER article_correction_audits_protect_history
BEFORE INSERT OR UPDATE OR DELETE ON private.article_correction_audits
FOR EACH ROW EXECUTE FUNCTION private.protect_article_correction_audit();

-- The authenticated API can read only the public disclosure note and time for
-- its own published article while the owner's alpha membership remains active.
CREATE OR REPLACE FUNCTION private.read_article_correction_disclosure(
  requested_article_id uuid
)
RETURNS TABLE (
  correction_note text,
  corrected_at timestamp with time zone
)
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    audit.correction_note,
    audit.corrected_at
  FROM private.article_correction_audits AS audit
  INNER JOIN public.articles AS article
    ON article.id = audit.article_id
    AND article.owner_id = audit.owner_id
  WHERE audit.article_id = requested_article_id
    AND article.owner_id = auth.uid()
    AND article.status = 'published'
    AND EXISTS (
      SELECT 1
      FROM public.alpha_memberships AS membership
      WHERE membership.user_id = auth.uid()
        AND membership.status = 'active'
    )
  ORDER BY audit.corrected_at DESC, audit.id DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.read_article_correction_disclosure(uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION private.read_article_correction_disclosure(uuid)
FROM anon, authenticated, edison_public, service_role;
GRANT USAGE ON SCHEMA private TO edison_api;
GRANT EXECUTE ON FUNCTION private.read_article_correction_disclosure(uuid)
TO edison_api;
