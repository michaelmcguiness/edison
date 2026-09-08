CREATE OR REPLACE FUNCTION private.knowledge_state_is_bounded(state_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE
  item jsonb;
BEGIN
  IF jsonb_typeof(state_value) <> 'array'
    OR jsonb_array_length(state_value) > 80
    OR octet_length(state_value::text) > 262144 THEN
    RETURN false;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(state_value) LOOP
    IF jsonb_typeof(item) <> 'object'
      OR NOT (item ?& ARRAY['topic', 'level', 'note'])
      OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
      OR jsonb_typeof(item -> 'topic') <> 'string'
      OR char_length(btrim(item ->> 'topic')) NOT BETWEEN 1 AND 200
      OR jsonb_typeof(item -> 'level') <> 'string'
      OR item ->> 'level' NOT IN (
        'new', 'beginner', 'intermediate', 'advanced'
      )
      OR jsonb_typeof(item -> 'note') NOT IN ('string', 'null')
      OR (
        jsonb_typeof(item -> 'note') = 'string'
        AND char_length(item ->> 'note') > 500
      ) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.knowledge_state_is_bounded(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.knowledge_state_is_bounded(jsonb)
TO edison_api, service_role;--> statement-breakpoint
ALTER TABLE "feed_preferences" ADD CONSTRAINT "feed_preferences_knowledge_state_bounded" CHECK (private.knowledge_state_is_bounded("feed_preferences"."knowledge_state"));--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_interests AS interest
    WHERE interest.kind::text = 'explicit'
      AND interest.status <> 'deleted'
    GROUP BY interest.user_id
    HAVING count(*) > 50
  ) THEN
    RAISE EXCEPTION 'cannot enforce explicit-interest limit while a reader retains more than 50 rows'
      USING ERRCODE = '23514';
  END IF;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.enforce_retained_explicit_interest_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  retained_count bigint;
BEGIN
  IF NEW.kind::text <> 'explicit' OR NEW.status = 'deleted' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('edison-interests:' || NEW.user_id::text, 0)
  );

  IF TG_OP = 'UPDATE' THEN
    SELECT count(*)
    INTO retained_count
    FROM public.user_interests AS interest
    WHERE interest.user_id = NEW.user_id
      AND interest.kind::text = 'explicit'
      AND interest.status <> 'deleted'
      AND interest.id <> OLD.id;
  ELSE
    SELECT count(*)
    INTO retained_count
    FROM public.user_interests AS interest
    WHERE interest.user_id = NEW.user_id
      AND interest.kind::text = 'explicit'
      AND interest.status <> 'deleted';
  END IF;

  IF retained_count >= 50 THEN
    RAISE EXCEPTION 'a reader can retain at most 50 explicit interests'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'user_interests_retained_explicit_limit';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.enforce_retained_explicit_interest_limit()
FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "user_interests_retained_explicit_limit"
BEFORE INSERT OR UPDATE OF user_id, kind, status
ON public.user_interests
FOR EACH ROW
EXECUTE FUNCTION private.enforce_retained_explicit_interest_limit();
