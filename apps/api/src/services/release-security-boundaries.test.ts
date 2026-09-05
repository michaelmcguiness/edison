import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { requireActiveAdmin } from "./admin";
import { HttpError } from "../http/errors";

function source(relativeUrl: string) {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

test("elevated routes require a currently active admin membership", async () => {
  const previous = process.env.EDISON_ADMIN_EMAILS;
  process.env.EDISON_ADMIN_EMAILS = "owner@edison.test";

  try {
    await assert.rejects(
      () =>
        requireActiveAdmin({
          sub: "81000000-0000-4000-8000-000000000001",
          role: "authenticated",
          email: "reader@edison.test",
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 403 &&
        error.code === "admin_access_required",
    );
  } finally {
    if (previous === undefined) delete process.env.EDISON_ADMIN_EMAILS;
    else process.env.EDISON_ADMIN_EMAILS = previous;
  }

  const adminSource = source("./admin.ts");
  assert.match(adminSource, /await withActiveMember\(claims,/);

  for (const route of [
    "../../app/v1/admin/jobs/route.ts",
    "../../app/v1/admin/public-starter-editions/route.ts",
  ]) {
    assert.match(source(route), /await requireActiveAdmin\(claims\)/);
  }
});

test("the legacy public share route uses only the narrow public database role", () => {
  const route = source("../../app/v1/shares/[slug]/route.ts");
  const health = source("../../app/v1/health/route.ts");
  const migration = source(
    "../../../../supabase/migrations/20260904195000_public_article_share_boundary.sql",
  );

  assert.match(route, /withPublicDb/);
  assert.match(route, /edison_public_api\.read_article_share/);
  assert.doesNotMatch(route, /\bgetDb\b|\barticleShares\b|\balphaMemberships\b/);
  assert.match(health, /edison_public_api\.read_article_share\(text\)/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.article_shares/);
  assert.match(migration, /membership\.status = 'active'/);
});

test("Auth helper access uses only the bounded PG17 membership edge", () => {
  const migrationsUrl = new URL("../../../../supabase/migrations/", import.meta.url);
  const migrationSource = readdirSync(migrationsUrl)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
    .map((fileName) => readFileSync(new URL(fileName, migrationsUrl), "utf8"))
    .join("\n");
  const membershipMigration = source(
    "../../../../supabase/migrations/20260904202000_edison_api_auth_membership.sql",
  );

  assert.doesNotMatch(
    migrationSource,
    /GRANT\s+USAGE\s+ON\s+SCHEMA\s+"?auth"?\s+TO\s+"?edison_api"?/i,
  );
  assert.doesNotMatch(
    migrationSource,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+"?auth"?\."?uid"?\(\)\s+TO\s+"?edison_api"?/i,
  );
  assert.match(
    membershipMigration,
    /GRANT\s+authenticated\s+TO\s+edison_api\s+WITH\s+ADMIN\s+FALSE,\s*INHERIT\s+TRUE,\s*SET\s+FALSE/i,
  );
});

test("dispatch and reconciliation logs never serialize caught error objects", () => {
  for (const file of [
    "../../app/v1/generation-jobs/route.ts",
    "./generation-jobs.ts",
    "./feed-commands.ts",
    "./daily-editions.ts",
  ]) {
    const contents = source(file);
    assert.match(contents, /safeCaughtErrorMetadata/);
    assert.doesNotMatch(contents, /\berror:\s*(?:error|releaseError)\b/);
    assert.doesNotMatch(contents, /\n\s*(?:error|releaseError),\s*\n/);
  }
});
