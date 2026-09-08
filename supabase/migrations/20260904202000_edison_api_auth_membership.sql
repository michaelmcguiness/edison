-- Supabase owns the auth schema and intentionally withholds its grant option
-- from the project migration role. Inherit the built-in authenticated role's
-- Auth helper access without this membership granting role-switch or delegation
-- rights.
GRANT authenticated TO edison_api
WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
