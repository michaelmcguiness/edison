-- D44 retains the existing active cohort and operator revocations. Future
-- verified signups remain pending until an email-bound invitation is redeemed.
-- Recipient projections remain available only to the server's narrow role;
-- neither anonymous nor signed-in PostgREST clients may skip the API member gate.
REVOKE ALL ON SCHEMA edison_public_api FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION edison_public_api.read_article_share(text),edison_public_api.read_demand_article_share(text)
 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.alpha_memberships DROP CONSTRAINT alpha_memberships_status_valid;
ALTER TABLE public.alpha_memberships ADD CONSTRAINT alpha_memberships_status_valid CHECK(status IN ('pending','active','revoked'));
ALTER TABLE public.alpha_memberships ALTER COLUMN status SET DEFAULT 'pending';
CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.profiles(id,email,display_name) VALUES(NEW.id,coalesce(NEW.email,''),
   coalesce(nullif(NEW.raw_user_meta_data->>'display_name',''),nullif(split_part(coalesce(NEW.email,''),'@',1),''))) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.feed_preferences(user_id,category_visibility,category_order) VALUES(NEW.id,
   '{"tech-science":true,"business":true,"arts-culture":true,"sports":true,"entertainment":true}'::jsonb,
   '["tech-science","business","arts-culture","sports","entertainment"]'::jsonb) ON CONFLICT(user_id) DO NOTHING;
 INSERT INTO public.alpha_memberships(user_id,status) VALUES(NEW.id,'pending') ON CONFLICT(user_id) DO NOTHING;
 INSERT INTO public.editorial_direction_states(user_id,section) VALUES(NEW.id,'news'),(NEW.id,'books'),(NEW.id,'podcasts') ON CONFLICT(user_id,section) DO NOTHING;
 RETURN NEW;
END $$;

CREATE TABLE private.demand_invite_grants (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
 allowance integer NOT NULL DEFAULT 5 CHECK(allowance=5),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.demand_invitations (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
 inviter_user_id uuid NOT NULL REFERENCES private.demand_invite_grants(user_id) ON DELETE RESTRICT,
 recipient_email text NOT NULL CHECK(recipient_email=lower(btrim(recipient_email)) AND char_length(recipient_email) BETWEEN 3 AND 320 AND recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','expired','revoked','redeemed')),
 expires_at timestamptz NOT NULL DEFAULT(now()+interval '7 days'),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,redeemed_at timestamptz,redeemed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 delivery_attempts integer NOT NULL DEFAULT 0 CHECK(delivery_attempts>=0 AND delivery_attempts<=100),delivery_lease_expires_at timestamptz,
 last_error_code text CHECK(last_error_code IS NULL OR char_length(last_error_code)<=80),
 CHECK(expires_at>created_at),CHECK((status='redeemed')=(redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL))
);
CREATE INDEX demand_invitations_inviter_created ON private.demand_invitations(inviter_user_id,created_at DESC);
CREATE UNIQUE INDEX demand_invitations_open_recipient ON private.demand_invitations(inviter_user_id,recipient_email) WHERE status IN ('pending','sending','sent');
CREATE TABLE private.demand_invitation_operations (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),actor_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 128 AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'),
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
 invitation_id uuid NOT NULL REFERENCES private.demand_invitations(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK(operation IN ('create','resend','revoke','redeem')),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=32768),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_user_id,idempotency_key)
);
-- Delivery is an append-only outcome for the exact operation, not the current
-- invitation status. A failed resend must never replay as a successful send.
CREATE TABLE private.demand_invitation_delivery_results (
 operation_id uuid PRIMARY KEY REFERENCES private.demand_invitation_operations(id) ON DELETE RESTRICT,
 outcome text NOT NULL CHECK(outcome IN ('sent','failed','unknown','not_attempted')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION private.protect_demand_invitation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'invitation history is retained' USING ERRCODE='23514'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.inviter_user_id IS DISTINCT FROM OLD.inviter_user_id OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR (OLD.status='redeemed' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.redeemed_by IS DISTINCT FROM OLD.redeemed_by OR NEW.redeemed_at IS DISTINCT FROM OLD.redeemed_at))
 THEN RAISE EXCEPTION 'invitation identity and redemption are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_demand_invitation() FROM PUBLIC;
CREATE TRIGGER demand_invitations_immutable BEFORE UPDATE OR DELETE ON private.demand_invitations FOR EACH ROW EXECUTE FUNCTION private.protect_demand_invitation();
CREATE TRIGGER demand_invite_grants_immutable BEFORE UPDATE OR DELETE ON private.demand_invite_grants FOR EACH ROW EXECUTE FUNCTION private.protect_demand_allowance_record();
CREATE TRIGGER demand_invitation_operations_immutable BEFORE UPDATE OR DELETE ON private.demand_invitation_operations FOR EACH ROW EXECUTE FUNCTION private.protect_demand_allowance_record();
CREATE TRIGGER demand_invitation_delivery_results_immutable BEFORE UPDATE OR DELETE ON private.demand_invitation_delivery_results FOR EACH ROW EXECUTE FUNCTION private.protect_demand_allowance_record();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['demand_invite_grants','demand_invitations','demand_invitation_operations','demand_invitation_delivery_results'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE private.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role,edison_api,edison_public,edison_demand_api,edison_demand_worker',name);
  EXECUTE format('GRANT SELECT,INSERT ON private.%I TO edison_demand_worker',name);
  EXECUTE format('CREATE POLICY %I ON private.%I FOR SELECT TO edison_demand_worker USING(true)',name||'_worker_select',name);
  EXECUTE format('CREATE POLICY %I ON private.%I FOR INSERT TO edison_demand_worker WITH CHECK(true)',name||'_worker_insert',name);
 END LOOP;
END $$;
GRANT UPDATE ON private.demand_invitations TO edison_demand_worker;
CREATE POLICY demand_invitations_worker_update ON private.demand_invitations FOR UPDATE TO edison_demand_worker USING(true) WITH CHECK(true);

CREATE FUNCTION private.demand_invitation_member(requested_user_id uuid)
RETURNS TABLE(email text,status text) LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT u.email,m.status FROM auth.users u JOIN public.alpha_memberships m ON m.user_id=u.id WHERE u.id=requested_user_id
$$;
REVOKE ALL ON FUNCTION private.demand_invitation_member(uuid) FROM PUBLIC,anon,authenticated,service_role,edison_api,edison_public,edison_demand_api;
GRANT EXECUTE ON FUNCTION private.demand_invitation_member(uuid) TO edison_demand_worker;

CREATE FUNCTION private.redeem_demand_invitation(requested_invitation_id uuid,recipient_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE invitation private.demand_invitations%ROWTYPE; recipient_email text; recipient_status text; inviter_status text; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('edison-invitation-admission',0));
 SELECT * INTO invitation FROM private.demand_invitations WHERE id=requested_invitation_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT lower(u.email),m.status INTO recipient_email,recipient_status FROM auth.users u JOIN public.alpha_memberships m ON m.user_id=u.id
  WHERE u.id=recipient_user_id AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false) FOR UPDATE OF m;
 IF recipient_status IS NULL OR recipient_status='revoked' THEN RETURN false; END IF;
 IF invitation.status='redeemed' THEN RETURN invitation.redeemed_by=recipient_user_id AND recipient_status='active'; END IF;
 SELECT status INTO inviter_status FROM public.alpha_memberships WHERE user_id=invitation.inviter_user_id FOR SHARE;
 IF recipient_status NOT IN ('pending','active') OR recipient_email IS DISTINCT FROM invitation.recipient_email
   OR invitation.status NOT IN ('pending','sending','sent') OR invitation.expires_at<=statement_timestamp()
   OR inviter_status IS DISTINCT FROM 'active' THEN RETURN false; END IF;
 UPDATE private.demand_invitations SET status='redeemed',redeemed_by=recipient_user_id,redeemed_at=statement_timestamp(),updated_at=statement_timestamp(),delivery_lease_expires_at=NULL WHERE id=invitation.id;
 UPDATE public.alpha_memberships SET status='active',invited_by=invitation.inviter_user_id WHERE user_id=recipient_user_id AND status='pending';
 INSERT INTO private.demand_invite_grants(user_id) VALUES(recipient_user_id) ON CONFLICT(user_id) DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.redeem_demand_invitation(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,edison_api,edison_public,edison_demand_api;
GRANT EXECUTE ON FUNCTION private.redeem_demand_invitation(uuid,uuid) TO edison_demand_worker;

-- An old anonymous token is only a continuity credential presented alongside
-- an admitted verified account. It can no longer authorize reading or work.
CREATE OR REPLACE FUNCTION private.demand_principal_is_active(requested_principal_id uuid)
RETURNS boolean LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM private.demand_principals leaf JOIN private.demand_principals reader ON reader.id=private.demand_reader_id(leaf.id)
  JOIN public.alpha_memberships m ON m.user_id=reader.account_user_id
  WHERE leaf.id=requested_principal_id AND leaf.revoked_at IS NULL AND reader.revoked_at IS NULL AND m.status='active')
$$;
