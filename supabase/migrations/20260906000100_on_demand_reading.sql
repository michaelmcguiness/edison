DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edison_demand_api') THEN
    CREATE ROLE edison_demand_api
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edison_demand_worker') THEN
    CREATE ROLE edison_demand_worker
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE edison_demand_api
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE edison_demand_worker
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

GRANT edison_demand_api, edison_demand_worker TO postgres;

CREATE TABLE private.demand_principals (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  account_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  guest_token_hash text,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_principals_exactly_one_binding
    CHECK (num_nonnulls(account_user_id, guest_token_hash) = 1),
  CONSTRAINT demand_principals_guest_token_hash_valid
    CHECK (guest_token_hash IS NULL OR guest_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT demand_principals_expiry_consistent
    CHECK (
      (account_user_id IS NOT NULL AND expires_at IS NULL)
      OR
      (
        guest_token_hash IS NOT NULL
        AND expires_at IS NOT NULL
        AND expires_at > created_at
      )
    ),
  CONSTRAINT demand_principals_revocation_time_valid
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX demand_principals_account_user_unique
ON private.demand_principals (account_user_id)
WHERE account_user_id IS NOT NULL;

CREATE UNIQUE INDEX demand_principals_guest_token_hash_unique
ON private.demand_principals (guest_token_hash)
WHERE guest_token_hash IS NOT NULL;

CREATE TABLE private.demand_loops (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL
    REFERENCES private.demand_principals(id) ON DELETE CASCADE,
  title text NOT NULL,
  original_curiosity text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  principles jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_loops_title_length
    CHECK (
      title = btrim(title)
      AND char_length(title) BETWEEN 1 AND 120
    ),
  CONSTRAINT demand_loops_curiosity_length
    CHECK (
      original_curiosity = btrim(original_curiosity)
      AND char_length(original_curiosity) BETWEEN 1 AND 500
    ),
  CONSTRAINT demand_loops_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT demand_loops_principles_valid
    CHECK (
      jsonb_typeof(principles) = 'object'
      AND pg_column_size(principles) <= 65536
    )
);

CREATE UNIQUE INDEX demand_loops_principal_id_unique
ON private.demand_loops (principal_id, id);

CREATE INDEX demand_loops_principal_created_idx
ON private.demand_loops (principal_id, created_at);

CREATE TABLE private.demand_requests (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL
    REFERENCES private.demand_principals(id) ON DELETE CASCADE,
  loop_id uuid NOT NULL,
  idea_id uuid,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  stage text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  snapshot jsonb NOT NULL,
  result jsonb,
  progress jsonb,
  failure_code text,
  workflow_run_id text,
  lease_expires_at timestamp with time zone,
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  reserved_microusd integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_requests_loop_owner_fk
    FOREIGN KEY (principal_id, loop_id)
    REFERENCES private.demand_loops(principal_id, id) ON DELETE CASCADE,
  CONSTRAINT demand_requests_kind_valid
    CHECK (kind IN ('ideas', 'article', 'feedback', 'question')),
  CONSTRAINT demand_requests_status_valid
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT demand_requests_stage_valid
    CHECK (
      stage = btrim(stage)
      AND char_length(stage) BETWEEN 1 AND 80
    ),
  CONSTRAINT demand_requests_key_valid
    CHECK (
      char_length(idempotency_key) BETWEEN 8 AND 128
      AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    ),
  CONSTRAINT demand_requests_fingerprint_valid
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT demand_requests_snapshot_valid
    CHECK (
      jsonb_typeof(snapshot) = 'object'
      AND pg_column_size(snapshot) <= 1048576
    ),
  CONSTRAINT demand_requests_result_valid
    CHECK (
      result IS NULL
      OR (
        jsonb_typeof(result) = 'object'
        AND pg_column_size(result) <= 4194304
      )
    ),
  CONSTRAINT demand_requests_progress_valid
    CHECK (progress IS NULL OR (jsonb_typeof(progress) = 'object' AND pg_column_size(progress) <= 4194304)),
  CONSTRAINT demand_requests_failure_code_valid
    CHECK (
      failure_code IS NULL
      OR (
        failure_code = btrim(failure_code)
        AND char_length(failure_code) BETWEEN 1 AND 100
      )
    ),
  CONSTRAINT demand_requests_workflow_run_valid
    CHECK (
      workflow_run_id IS NULL
      OR char_length(workflow_run_id) BETWEEN 1 AND 200
    ),
  CONSTRAINT demand_requests_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT demand_requests_reservation_nonnegative
    CHECK (reserved_microusd >= 0),
  CONSTRAINT demand_requests_article_has_idea
    CHECK (kind <> 'article' OR idea_id IS NOT NULL)
);

CREATE UNIQUE INDEX demand_requests_principal_key_unique
ON private.demand_requests (principal_id, idempotency_key);

CREATE UNIQUE INDEX demand_requests_principal_id_unique
ON private.demand_requests (principal_id, id);

CREATE UNIQUE INDEX demand_requests_principal_loop_id_unique
ON private.demand_requests (principal_id, loop_id, id);

CREATE UNIQUE INDEX demand_requests_article_idea_unique
ON private.demand_requests (principal_id, idea_id)
WHERE kind = 'article' AND idea_id IS NOT NULL;

CREATE INDEX demand_requests_claim_idx
ON private.demand_requests (status, next_attempt_at, lease_expires_at);

CREATE INDEX demand_requests_principal_created_idx
ON private.demand_requests (principal_id, created_at);

CREATE INDEX demand_requests_created_idx
ON private.demand_requests (created_at);

-- Budget-only bridge: the new worker receives no legacy rows or private text.
-- Existing paid work must drain before this new path can reserve project spend.
CREATE OR REPLACE FUNCTION private.demand_legacy_budget()
RETURNS TABLE(monthly bigint, daily bigint, unpriced boolean, outstanding boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT
    coalesce(sum(cost_microusd) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::bigint,
    coalesce(sum(cost_microusd) FILTER (WHERE created_at >= now() - interval '24 hours'), 0)::bigint,
    coalesce(bool_or(pricing_status = 'unpriced'), false),
    EXISTS (SELECT 1 FROM private.generation_jobs WHERE status IN ('queued','running'))
      OR EXISTS (SELECT 1 FROM private.ai_request_reservations WHERE status IN ('reserved','in_progress'))
  FROM private.usage_ledger WHERE provider = 'openai';
$$;
REVOKE ALL ON FUNCTION private.demand_legacy_budget() FROM PUBLIC, anon, authenticated, service_role, edison_demand_api;
GRANT EXECUTE ON FUNCTION private.demand_legacy_budget() TO edison_demand_worker;

CREATE OR REPLACE FUNCTION private.demand_legacy_daily_counts(requested_principal_id uuid)
RETURNS TABLE(article bigint, feedback bigint, question bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT
    (SELECT count(*) FROM private.generation_jobs g
      WHERE g.user_id = p.account_user_id AND g.created_at >= now() - interval '24 hours'),
    (SELECT count(*) FROM private.ai_request_reservations r
      WHERE r.user_id = p.account_user_id AND r.operation = 'preference_command' AND r.created_at >= now() - interval '24 hours'),
    (SELECT count(*) FROM private.ai_request_reservations r
      WHERE r.user_id = p.account_user_id AND r.operation = 'article_qa' AND r.created_at >= now() - interval '24 hours')
  FROM private.demand_principals p WHERE p.id = requested_principal_id;
$$;
REVOKE ALL ON FUNCTION private.demand_legacy_daily_counts(uuid) FROM PUBLIC, anon, authenticated, service_role, edison_demand_api;
GRANT EXECUTE ON FUNCTION private.demand_legacy_daily_counts(uuid) TO edison_demand_worker;

CREATE TABLE private.demand_ideas (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL
    REFERENCES private.demand_principals(id) ON DELETE CASCADE,
  loop_id uuid NOT NULL,
  batch_request_id uuid NOT NULL,
  batch_revision integer NOT NULL,
  rank smallint NOT NULL DEFAULT 1,
  title text NOT NULL,
  deck text NOT NULL,
  brief jsonb NOT NULL,
  evidence jsonb NOT NULL,
  article_request_id uuid,
  saved boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_ideas_loop_owner_fk
    FOREIGN KEY (principal_id, loop_id)
    REFERENCES private.demand_loops(principal_id, id) ON DELETE CASCADE,
  CONSTRAINT demand_ideas_rank_valid CHECK (rank BETWEEN 1 AND 6),
  CONSTRAINT demand_ideas_batch_request_owner_fk
    FOREIGN KEY (principal_id, loop_id, batch_request_id)
    REFERENCES private.demand_requests(principal_id, loop_id, id)
    ON DELETE CASCADE,
  CONSTRAINT demand_ideas_article_request_owner_fk
    FOREIGN KEY (principal_id, loop_id, article_request_id)
    REFERENCES private.demand_requests(principal_id, loop_id, id)
    ON DELETE CASCADE,
  CONSTRAINT demand_ideas_batch_revision_nonnegative
    CHECK (batch_revision >= 0),
  CONSTRAINT demand_ideas_title_length
    CHECK (
      title = btrim(title)
      AND char_length(title) BETWEEN 1 AND 180
    ),
  CONSTRAINT demand_ideas_deck_length
    CHECK (
      deck = btrim(deck)
      AND char_length(deck) BETWEEN 1 AND 500
    ),
  CONSTRAINT demand_ideas_brief_valid
    CHECK (
      jsonb_typeof(brief) = 'object'
      AND pg_column_size(brief) <= 262144
    ),
  CONSTRAINT demand_ideas_evidence_valid
    CHECK (
      jsonb_typeof(evidence) = 'object'
      AND pg_column_size(evidence) <= 1048576
    )
);

CREATE UNIQUE INDEX demand_ideas_principal_id_unique
ON private.demand_ideas (principal_id, id);

CREATE UNIQUE INDEX demand_ideas_principal_loop_id_unique
ON private.demand_ideas (principal_id, loop_id, id);

CREATE UNIQUE INDEX demand_ideas_article_request_unique
ON private.demand_ideas (article_request_id)
WHERE article_request_id IS NOT NULL;

CREATE INDEX demand_ideas_loop_batch_idx
ON private.demand_ideas (principal_id, loop_id, batch_request_id);

ALTER TABLE private.demand_requests
ADD CONSTRAINT demand_requests_idea_owner_fk
FOREIGN KEY (principal_id, loop_id, idea_id)
REFERENCES private.demand_ideas(principal_id, loop_id, id)
ON DELETE CASCADE;

CREATE TABLE private.demand_stages (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL
    REFERENCES private.demand_principals(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  stage_key text NOT NULL,
  request_fingerprint text NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  provider_response_id text,
  output jsonb,
  usage jsonb,
  cost_microusd integer,
  pricing_status text,
  lease_expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_stages_request_owner_fk
    FOREIGN KEY (principal_id, request_id)
    REFERENCES private.demand_requests(principal_id, id) ON DELETE CASCADE,
  CONSTRAINT demand_stages_key_valid
    CHECK (
      stage_key = btrim(stage_key)
      AND char_length(stage_key) BETWEEN 1 AND 80
    ),
  CONSTRAINT demand_stages_fingerprint_valid
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT demand_stages_snapshot_valid
    CHECK (
      jsonb_typeof(snapshot) = 'object'
      AND pg_column_size(snapshot) <= 1048576
    ),
  CONSTRAINT demand_stages_status_valid
    CHECK (status IN ('reserved', 'succeeded', 'failed', 'uncertain')),
  CONSTRAINT demand_stages_success_complete
    CHECK (
      status <> 'succeeded'
      OR (
        provider_response_id IS NOT NULL
        AND output IS NOT NULL
        AND pricing_status IS NOT NULL
      )
    ),
  CONSTRAINT demand_stages_response_id_valid
    CHECK (
      provider_response_id IS NULL
      OR (
        provider_response_id = btrim(provider_response_id)
        AND char_length(provider_response_id) BETWEEN 1 AND 200
      )
    ),
  CONSTRAINT demand_stages_output_valid
    CHECK (
      output IS NULL
      OR (
        jsonb_typeof(output) = 'object'
        AND pg_column_size(output) <= 4194304
      )
    ),
  CONSTRAINT demand_stages_usage_valid
    CHECK (
      usage IS NULL
      OR (
        jsonb_typeof(usage) = 'object'
        AND pg_column_size(usage) <= 65536
      )
    ),
  CONSTRAINT demand_stages_cost_nonnegative
    CHECK (cost_microusd IS NULL OR cost_microusd >= 0),
  CONSTRAINT demand_stages_pricing_valid
    CHECK (
      (pricing_status IS NULL AND cost_microusd IS NULL)
      OR (pricing_status = 'priced' AND cost_microusd IS NOT NULL)
      OR (pricing_status = 'unpriced' AND cost_microusd IS NULL)
    )
);

CREATE UNIQUE INDEX demand_stages_request_key_unique
ON private.demand_stages (request_id, stage_key);

CREATE UNIQUE INDEX demand_stages_principal_request_id_unique
ON private.demand_stages (principal_id, request_id, id);

CREATE UNIQUE INDEX demand_stages_provider_response_unique
ON private.demand_stages (provider_response_id)
WHERE provider_response_id IS NOT NULL;

CREATE INDEX demand_stages_lease_idx
ON private.demand_stages (status, lease_expires_at);

CREATE TABLE private.demand_mutations (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL
    REFERENCES private.demand_principals(id) ON DELETE CASCADE,
  loop_id uuid NOT NULL,
  request_id uuid NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_mutations_loop_owner_fk
    FOREIGN KEY (principal_id, loop_id)
    REFERENCES private.demand_loops(principal_id, id) ON DELETE CASCADE,
  CONSTRAINT demand_mutations_request_owner_fk
    FOREIGN KEY (principal_id, loop_id, request_id)
    REFERENCES private.demand_requests(principal_id, loop_id, id)
    ON DELETE CASCADE,
  CONSTRAINT demand_mutations_receipt_valid
    CHECK (
      jsonb_typeof(receipt) = 'object'
      AND pg_column_size(receipt) <= 262144
    )
);

CREATE UNIQUE INDEX demand_mutations_request_unique
ON private.demand_mutations (request_id);

CREATE INDEX demand_mutations_loop_created_idx
ON private.demand_mutations (principal_id, loop_id, created_at);

CREATE TABLE private.demand_events (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL
    REFERENCES private.demand_principals(id) ON DELETE CASCADE,
  loop_id uuid NOT NULL,
  idea_id uuid,
  type text NOT NULL,
  idempotency_key text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_events_loop_owner_fk
    FOREIGN KEY (principal_id, loop_id)
    REFERENCES private.demand_loops(principal_id, id) ON DELETE CASCADE,
  CONSTRAINT demand_events_idea_owner_fk
    FOREIGN KEY (principal_id, loop_id, idea_id)
    REFERENCES private.demand_ideas(principal_id, loop_id, id)
    ON DELETE CASCADE,
  CONSTRAINT demand_events_type_valid
    CHECK (type IN ('opened', 'saved', 'progress')),
  CONSTRAINT demand_events_key_valid
    CHECK (
      char_length(idempotency_key) BETWEEN 8 AND 128
      AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    ),
  CONSTRAINT demand_events_data_valid
    CHECK (
      jsonb_typeof(data) = 'object'
      AND pg_column_size(data) <= 262144
    )
);

CREATE UNIQUE INDEX demand_events_principal_key_unique
ON private.demand_events (principal_id, idempotency_key);

CREATE INDEX demand_events_loop_created_idx
ON private.demand_events (principal_id, loop_id, created_at);

CREATE TABLE private.demand_usage (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL
    REFERENCES private.demand_principals(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  response_id text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  search_calls integer NOT NULL DEFAULT 0,
  cost_microusd integer,
  pricing_status text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_usage_request_owner_fk
    FOREIGN KEY (principal_id, request_id)
    REFERENCES private.demand_requests(principal_id, id) ON DELETE CASCADE,
  CONSTRAINT demand_usage_stage_owner_fk
    FOREIGN KEY (principal_id, request_id, stage_id)
    REFERENCES private.demand_stages(principal_id, request_id, id)
    ON DELETE CASCADE,
  CONSTRAINT demand_usage_response_id_valid
    CHECK (
      response_id = btrim(response_id)
      AND char_length(response_id) BETWEEN 1 AND 200
    ),
  CONSTRAINT demand_usage_model_valid
    CHECK (
      model = btrim(model)
      AND char_length(model) BETWEEN 1 AND 200
    ),
  CONSTRAINT demand_usage_pricing_valid
    CHECK (
      (pricing_status = 'priced' AND cost_microusd IS NOT NULL)
      OR
      (pricing_status = 'unpriced' AND cost_microusd IS NULL)
    ),
  CONSTRAINT demand_usage_values_nonnegative
    CHECK (
      input_tokens >= 0
      AND cached_input_tokens >= 0
      AND output_tokens >= 0
      AND search_calls >= 0
      AND (cost_microusd IS NULL OR cost_microusd >= 0)
    )
);

CREATE UNIQUE INDEX demand_usage_response_unique
ON private.demand_usage (response_id);

CREATE INDEX demand_usage_principal_created_idx
ON private.demand_usage (principal_id, created_at);

CREATE INDEX demand_usage_created_idx
ON private.demand_usage (created_at);

CREATE INDEX demand_usage_request_idx
ON private.demand_usage (request_id);

CREATE TRIGGER demand_loops_touch_updated_at
BEFORE UPDATE ON private.demand_loops
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER demand_requests_touch_updated_at
BEFORE UPDATE ON private.demand_requests
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER demand_stages_touch_updated_at
BEFORE UPDATE ON private.demand_stages
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- Idempotency identities and frozen provider inputs may never be repurposed.
CREATE OR REPLACE FUNCTION private.protect_demand_request_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF ROW(
    NEW.principal_id,
    NEW.loop_id,
    NEW.idea_id,
    NEW.kind,
    NEW.idempotency_key,
    NEW.request_fingerprint,
    NEW.snapshot,
    NEW.reserved_microusd
  ) IS DISTINCT FROM ROW(
    OLD.principal_id,
    OLD.loop_id,
    OLD.idea_id,
    OLD.kind,
    OLD.idempotency_key,
    OLD.request_fingerprint,
    OLD.snapshot,
    OLD.reserved_microusd
  ) THEN
    RAISE EXCEPTION 'demand request identity is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'demand_requests_identity_immutable';
  END IF;

  IF OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result THEN
    RAISE EXCEPTION 'demand request result cannot be replaced'
      USING ERRCODE = '23514',
        CONSTRAINT = 'demand_requests_result_immutable';
  END IF;

  IF OLD.workflow_run_id IS NOT NULL
    AND NEW.workflow_run_id IS DISTINCT FROM OLD.workflow_run_id
    AND NOT (OLD.status = 'failed' AND NEW.status = 'queued'
      AND NEW.workflow_run_id IS NULL AND OLD.result IS NULL AND NEW.result IS NULL) THEN
    RAISE EXCEPTION 'demand request workflow run cannot be replaced'
      USING ERRCODE = '23514',
        CONSTRAINT = 'demand_requests_workflow_run_immutable';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_demand_request_identity() FROM PUBLIC;

CREATE TRIGGER demand_requests_identity_immutable
BEFORE UPDATE ON private.demand_requests
FOR EACH ROW EXECUTE FUNCTION private.protect_demand_request_identity();

CREATE OR REPLACE FUNCTION private.protect_demand_stage_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'failed', 'uncertain') THEN
    RAISE EXCEPTION 'terminal demand stage cannot be changed'
      USING ERRCODE = '23514',
        CONSTRAINT = 'demand_stages_terminal_immutable';
  END IF;

  IF ROW(
    NEW.principal_id,
    NEW.request_id,
    NEW.stage_key,
    NEW.request_fingerprint,
    NEW.snapshot
  ) IS DISTINCT FROM ROW(
    OLD.principal_id,
    OLD.request_id,
    OLD.stage_key,
    OLD.request_fingerprint,
    OLD.snapshot
  ) THEN
    RAISE EXCEPTION 'demand stage identity is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'demand_stages_identity_immutable';
  END IF;

  IF OLD.provider_response_id IS NOT NULL
    AND NEW.provider_response_id IS DISTINCT FROM OLD.provider_response_id THEN
    RAISE EXCEPTION 'demand stage provider response cannot be replaced'
      USING ERRCODE = '23514',
        CONSTRAINT = 'demand_stages_response_immutable';
  END IF;

  IF OLD.output IS NOT NULL AND NEW.output IS DISTINCT FROM OLD.output THEN
    RAISE EXCEPTION 'demand stage output cannot be replaced'
      USING ERRCODE = '23514',
        CONSTRAINT = 'demand_stages_output_immutable';
  END IF;

  IF OLD.usage IS NOT NULL AND NEW.usage IS DISTINCT FROM OLD.usage THEN
    RAISE EXCEPTION 'demand stage usage cannot be replaced'
      USING ERRCODE = '23514',
        CONSTRAINT = 'demand_stages_usage_immutable';
  END IF;

  IF OLD.pricing_status IS NOT NULL
    AND ROW(NEW.pricing_status, NEW.cost_microusd)
      IS DISTINCT FROM ROW(OLD.pricing_status, OLD.cost_microusd) THEN
    RAISE EXCEPTION 'demand stage pricing cannot be replaced'
      USING ERRCODE = '23514',
        CONSTRAINT = 'demand_stages_pricing_immutable';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_demand_stage_identity() FROM PUBLIC;

CREATE TRIGGER demand_stages_identity_immutable
BEFORE UPDATE ON private.demand_stages
FOR EACH ROW EXECUTE FUNCTION private.protect_demand_stage_identity();

-- This helper is the single database definition of whether new paid work may
-- begin. Account principals retain the existing active-membership boundary;
-- guest principals must be unexpired and unrevoked.
CREATE OR REPLACE FUNCTION private.demand_principal_is_active(
  requested_principal_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.demand_principals AS principal
    WHERE principal.id = requested_principal_id
      AND principal.revoked_at IS NULL
      AND (
        (
          principal.guest_token_hash IS NOT NULL
          AND principal.expires_at > pg_catalog.statement_timestamp()
        )
        OR
        (
          principal.account_user_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.alpha_memberships AS membership
            WHERE membership.user_id = principal.account_user_id
              AND membership.status = 'active'
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.demand_principal_is_active(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.demand_principal_is_active(uuid)
FROM anon, authenticated, service_role, edison_api, edison_public;
GRANT EXECUTE ON FUNCTION private.demand_principal_is_active(uuid)
TO edison_demand_api, edison_demand_worker;

-- Preserve existing account length/depth defaults without exposing raw profile
-- rows or importing account-wide inferred knowledge into a guest/loop context.
CREATE OR REPLACE FUNCTION private.demand_reader_preferences(requested_principal_id uuid)
RETURNS TABLE(article_length text, depth integer)
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT coalesce(preference.article_length::text, 'standard'),
    coalesce(preference.depth::integer, 60)
  FROM private.demand_principals AS principal
  LEFT JOIN public.feed_preferences AS preference
    ON preference.user_id = principal.account_user_id
  WHERE principal.id = requested_principal_id
    AND principal.account_user_id IS NOT NULL
    AND private.demand_principal_is_active(principal.id)
$$;
REVOKE ALL ON FUNCTION private.demand_reader_preferences(uuid)
FROM PUBLIC, anon, authenticated, service_role, edison_api, edison_public, edison_demand_api;
GRANT EXECUTE ON FUNCTION private.demand_reader_preferences(uuid) TO edison_demand_worker;

CREATE OR REPLACE FUNCTION private.current_active_demand_principal_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  configured_principal text;
  requested_principal uuid;
BEGIN
  configured_principal := pg_catalog.current_setting(
    'request.edison.demand_principal_id',
    true
  );

  IF configured_principal IS NULL OR configured_principal = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    requested_principal := configured_principal::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  IF private.demand_principal_is_active(requested_principal) THEN
    RETURN requested_principal;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.current_active_demand_principal_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_active_demand_principal_id()
FROM anon, authenticated, service_role, edison_api, edison_public,
  edison_demand_worker;
GRANT EXECUTE ON FUNCTION private.current_active_demand_principal_id()
TO edison_demand_api;

ALTER TABLE private.demand_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_principals FORCE ROW LEVEL SECURITY;
ALTER TABLE private.demand_loops ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_loops FORCE ROW LEVEL SECURITY;
ALTER TABLE private.demand_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE private.demand_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_ideas FORCE ROW LEVEL SECURITY;
ALTER TABLE private.demand_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_stages FORCE ROW LEVEL SECURITY;
ALTER TABLE private.demand_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_mutations FORCE ROW LEVEL SECURITY;
ALTER TABLE private.demand_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_events FORCE ROW LEVEL SECURITY;
ALTER TABLE private.demand_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY demand_principals_worker_all
ON private.demand_principals FOR ALL TO edison_demand_worker
USING (true) WITH CHECK (true);

CREATE POLICY demand_loops_worker_all
ON private.demand_loops FOR ALL TO edison_demand_worker
USING (true) WITH CHECK (true);
CREATE POLICY demand_loops_api_select_own
ON private.demand_loops FOR SELECT TO edison_demand_api
USING (
  principal_id = (SELECT private.current_active_demand_principal_id())
);
CREATE POLICY demand_loops_api_insert_own
ON private.demand_loops FOR INSERT TO edison_demand_api
WITH CHECK (
  principal_id = (SELECT private.current_active_demand_principal_id())
);
CREATE POLICY demand_loops_api_update_own
ON private.demand_loops FOR UPDATE TO edison_demand_api
USING (
  principal_id = (SELECT private.current_active_demand_principal_id())
)
WITH CHECK (
  principal_id = (SELECT private.current_active_demand_principal_id())
);

CREATE POLICY demand_requests_worker_all
ON private.demand_requests FOR ALL TO edison_demand_worker
USING (true) WITH CHECK (true);
CREATE POLICY demand_requests_api_select_own
ON private.demand_requests FOR SELECT TO edison_demand_api
USING (
  principal_id = (SELECT private.current_active_demand_principal_id())
);

CREATE POLICY demand_ideas_worker_all
ON private.demand_ideas FOR ALL TO edison_demand_worker
USING (true) WITH CHECK (true);
CREATE POLICY demand_ideas_api_select_own
ON private.demand_ideas FOR SELECT TO edison_demand_api
USING (
  principal_id = (SELECT private.current_active_demand_principal_id())
);
CREATE POLICY demand_ideas_api_update_own
ON private.demand_ideas FOR UPDATE TO edison_demand_api
USING (
  principal_id = (SELECT private.current_active_demand_principal_id())
)
WITH CHECK (
  principal_id = (SELECT private.current_active_demand_principal_id())
);

CREATE POLICY demand_stages_worker_all
ON private.demand_stages FOR ALL TO edison_demand_worker
USING (true) WITH CHECK (true);
CREATE POLICY demand_stages_api_select_own
ON private.demand_stages FOR SELECT TO edison_demand_api
USING (
  principal_id = (SELECT private.current_active_demand_principal_id())
);

CREATE POLICY demand_mutations_worker_select
ON private.demand_mutations FOR SELECT TO edison_demand_worker USING (true);
CREATE POLICY demand_mutations_worker_insert
ON private.demand_mutations FOR INSERT TO edison_demand_worker WITH CHECK (true);
CREATE POLICY demand_mutations_api_select_own
ON private.demand_mutations FOR SELECT TO edison_demand_api
USING (
  principal_id = (SELECT private.current_active_demand_principal_id())
);

CREATE POLICY demand_events_worker_all
ON private.demand_events FOR ALL TO edison_demand_worker
USING (true) WITH CHECK (true);
CREATE POLICY demand_events_api_select_own
ON private.demand_events FOR SELECT TO edison_demand_api
USING (
  principal_id = (SELECT private.current_active_demand_principal_id())
);
CREATE POLICY demand_events_api_insert_own
ON private.demand_events FOR INSERT TO edison_demand_api
WITH CHECK (
  principal_id = (SELECT private.current_active_demand_principal_id())
);

CREATE POLICY demand_usage_worker_select
ON private.demand_usage FOR SELECT TO edison_demand_worker USING (true);
CREATE POLICY demand_usage_worker_insert
ON private.demand_usage FOR INSERT TO edison_demand_worker WITH CHECK (true);

REVOKE ALL ON TABLE
  private.demand_principals,
  private.demand_loops,
  private.demand_requests,
  private.demand_ideas,
  private.demand_stages,
  private.demand_mutations,
  private.demand_events,
  private.demand_usage
FROM PUBLIC, anon, authenticated, service_role, edison_api, edison_public,
  edison_demand_api, edison_demand_worker;

GRANT USAGE ON SCHEMA private TO edison_demand_api, edison_demand_worker;

GRANT SELECT, INSERT, UPDATE, DELETE
ON private.demand_principals TO edison_demand_worker;
GRANT SELECT, INSERT, UPDATE, DELETE
ON private.demand_loops TO edison_demand_worker;
GRANT SELECT, INSERT, UPDATE, DELETE
ON private.demand_requests TO edison_demand_worker;
GRANT SELECT, INSERT, UPDATE, DELETE
ON private.demand_ideas TO edison_demand_worker;
GRANT SELECT, INSERT, UPDATE, DELETE
ON private.demand_stages TO edison_demand_worker;
GRANT SELECT, INSERT ON private.demand_mutations TO edison_demand_worker;
GRANT SELECT, INSERT, UPDATE, DELETE
ON private.demand_events TO edison_demand_worker;
GRANT SELECT, INSERT ON private.demand_usage TO edison_demand_worker;

GRANT SELECT, INSERT ON private.demand_loops TO edison_demand_api;
GRANT UPDATE (
  title,
  original_curiosity,
  revision,
  principles,
  updated_at
) ON private.demand_loops TO edison_demand_api;
GRANT SELECT ON private.demand_requests TO edison_demand_api;
GRANT SELECT ON private.demand_ideas TO edison_demand_api;
GRANT UPDATE (saved) ON private.demand_ideas TO edison_demand_api;
GRANT SELECT ON private.demand_stages TO edison_demand_api;
GRANT SELECT ON private.demand_mutations TO edison_demand_api;
GRANT SELECT, INSERT ON private.demand_events TO edison_demand_api;
