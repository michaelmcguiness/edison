CREATE SCHEMA IF NOT EXISTS edison_public_api;

REVOKE ALL ON SCHEMA edison_public_api FROM PUBLIC;
GRANT USAGE ON SCHEMA edison_public_api TO edison_public;

-- Anonymous share reads never receive table access. This SECURITY DEFINER
-- function returns only the immutable, contract-validated share snapshot and
-- hides revoked shares or shares owned by a deactivated alpha member.
CREATE OR REPLACE FUNCTION edison_public_api.read_article_share(
  requested_slug text
)
RETURNS TABLE (
  id uuid,
  slug text,
  snapshot jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    share_record.id,
    share_record.slug,
    share_record.snapshot,
    share_record.created_at
  FROM public.article_shares AS share_record
  WHERE share_record.slug = requested_slug
    AND share_record.revoked_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.alpha_memberships AS membership
      WHERE membership.user_id = share_record.user_id
        AND membership.status = 'active'
    )
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION edison_public_api.read_article_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION edison_public_api.read_article_share(text)
TO edison_public;

REVOKE ALL ON TABLE public.article_shares FROM edison_public;
REVOKE ALL ON TABLE public.alpha_memberships FROM edison_public;
