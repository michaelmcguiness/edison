import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildCorrectionSql,
  runArticleCorrectionCli,
  validateCorrectionPair,
  type CorrectionIdentity,
} from "../scripts/article-correction";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function genericSpecimens() {
  const articleId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const original = {
    id: articleId,
    category: "tech-science",
    topic: "A generic reviewed topic",
    title: "Original generic title",
    deck: "Original generic deck.",
    body: [
      {
        type: "paragraph",
        text: "Original generic paragraph.",
        citations: [{ sourceId, label: "Example source" }],
      },
    ],
    summary: ["Original point.", "Stable point two.", "Stable point three."],
    reading_minutes: 3,
    researched_at: "2026-09-05T12:00:00.000Z",
    published_at: "2026-09-05T12:00:00.000Z",
    model: "example-model",
    sources: [
      {
        id: sourceId,
        citation_order: 1,
        title: "Generic source title",
        publisher: "Generic publisher",
        url: "https://example.com/source",
        published_at: "2026-01-01T00:00:00.000Z",
        cited_claims: [],
      },
    ],
  };
  const corrected = structuredClone(original);
  corrected.title = "Corrected generic title";
  corrected.deck = "Corrected generic deck.";
  corrected.body[0]!.text = "Corrected generic paragraph.";
  corrected.body[0]!.citations[0]!.label = "Accurate source";
  corrected.summary[0] = "Corrected point.";
  corrected.reading_minutes = 4;
  corrected.sources[0]!.published_at = "2026-02-03T00:00:00.000Z";

  const originalBytes = Buffer.from(`${JSON.stringify(original, null, 2)}\n`);
  const correctedBytes = Buffer.from(`${JSON.stringify(corrected, null, 2)}\n`);
  const identity: CorrectionIdentity = {
    articleId,
    ownerId,
    sourceIds: [sourceId],
    originalSha256: sha256(originalBytes),
    correctedSha256: sha256(correctedBytes),
    idempotencyKey: "article-correction.generic.v1",
    correctedBy: "reviewed-editor",
    correctionNote: "A concise public correction note.",
  };

  return { original, corrected, originalBytes, correctedBytes, identity };
}

test("correction validation permits only reviewed content fields and source dates", () => {
  const input = genericSpecimens();
  const correction = validateCorrectionPair(input);

  assert.equal(correction.original.id, input.identity.articleId);
  assert.equal(correction.corrected.id, input.identity.articleId);
  assert.equal(correction.corrected.model, correction.original.model);
  assert.deepEqual(
    correction.corrected.sources.map((source) => source.id),
    input.identity.sourceIds,
  );
  assert.match(correction.requestFingerprint, /^[a-f0-9]{64}$/);
});

test("correction validation fails closed on hash, provenance, or source drift", () => {
  const hashDrift = genericSpecimens();
  hashDrift.correctedBytes = Buffer.concat([
    hashDrift.correctedBytes,
    Buffer.from(" "),
  ]);
  assert.throws(
    () => validateCorrectionPair(hashDrift),
    /Corrected article hash does not match/,
  );

  const provenanceDrift = genericSpecimens();
  const changedProvenance = structuredClone(provenanceDrift.corrected);
  changedProvenance.model = "different-model";
  provenanceDrift.correctedBytes = Buffer.from(
    `${JSON.stringify(changedProvenance, null, 2)}\n`,
  );
  provenanceDrift.identity.correctedSha256 = sha256(
    provenanceDrift.correctedBytes,
  );
  assert.throws(
    () => validateCorrectionPair(provenanceDrift),
    /generation provenance/,
  );

  const sourceDrift = genericSpecimens();
  const changedSource = structuredClone(sourceDrift.corrected);
  changedSource.sources[0]!.url = "https://example.com/different";
  sourceDrift.correctedBytes = Buffer.from(
    `${JSON.stringify(changedSource, null, 2)}\n`,
  );
  sourceDrift.identity.correctedSha256 = sha256(sourceDrift.correctedBytes);
  assert.throws(
    () => validateCorrectionPair(sourceDrift),
    /source identity, order, URL, title, publisher, or claims/,
  );
});

test("generated operator SQL uses exact CAS, history guards, and atomic audit", () => {
  const correction = validateCorrectionPair(genericSpecimens());
  const sql = buildCorrectionSql(correction);

  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.doesNotMatch(sql, /\\set\s+/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /article_correction_snapshot_fingerprint/);
  assert.match(sql, /current_snapshot IS DISTINCT FROM expected_before/);
  assert.match(sql, /article_correction_original_fingerprint_mismatch/);
  assert.match(sql, /FROM public\.article_shares/);
  assert.match(sql, /article_correction_share_history_exists/);
  assert.match(sql, /FROM public\.article_conversations/);
  assert.match(sql, /article_correction_conversation_history_exists/);
  assert.match(sql, /UPDATE public\.articles/);
  assert.match(sql, /UPDATE public\.article_sources/);
  assert.match(sql, /INSERT INTO private\.article_correction_audits/);
  assert.match(sql, /article_correction_idempotency_conflict/);
  assert.match(sql, /article_correction_replay_target_changed/);
  assert.match(sql, /corrected_by/);
  assert.match(sql, /correction_note/);
  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE|DROP|GRANT)\b/i);
  assert.doesNotMatch(
    sql,
    /(?:DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|Authorization:|Bearer\s)/i,
  );

  const articleUpdate = sql.match(
    /UPDATE public\.articles[\s\S]*?WHERE id =[^;]+;/,
  )?.[0];
  assert.ok(articleUpdate);
  const articleSet = articleUpdate.split("  WHERE id =", 1)[0]!;
  assert.match(articleSet, /title =/);
  assert.match(articleSet, /deck =/);
  assert.match(articleSet, /body =/);
  assert.match(articleSet, /summary =/);
  assert.match(articleSet, /reading_minutes =/);
  assert.match(articleSet, /updated_at =/);
  assert.doesNotMatch(
    articleSet,
    /(?:model|researched_at|published_at|category|topic|owner_id)\s*=/,
  );
});

test("operator CLI exposes validation and SQL emission only", () => {
  const help = runArticleCorrectionCli(["--help"]);
  const source = readFileSync(
    resolve(repositoryRoot, "scripts/article-correction.ts"),
    "utf8",
  );

  assert.match(help, /default validates/);
  assert.match(help, /--emit-sql \/private\/tmp\//);
  assert.doesNotMatch(help, /--execute|--publish|--post/i);
  assert.doesNotMatch(source, /\bfetch\s*\(|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /outputPath\.startsWith\("\/private\/tmp\/"\)/);
});

test("migration keeps full audit private and exposes only active-owner disclosure", () => {
  const migration = readFileSync(
    resolve(
      repositoryRoot,
      "supabase/migrations/20260905223000_article_correction_audit.sql",
    ),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE private\.article_correction_audits/);
  assert.match(migration, /before_snapshot jsonb NOT NULL/);
  assert.match(migration, /after_snapshot jsonb NOT NULL/);
  assert.match(migration, /expected_original_fingerprint text NOT NULL/);
  assert.match(migration, /corrected_fingerprint text NOT NULL/);
  assert.match(
    migration,
    /BEFORE INSERT OR UPDATE OR DELETE ON private\.article_correction_audits/,
  );
  assert.match(migration, /article correction audit history is immutable/);
  assert.match(
    migration,
    /ALTER TABLE private\.article_correction_audits ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE private\.article_correction_audits FROM edison_api/,
  );
  assert.match(
    migration,
    /RETURNS TABLE \(\s*correction_note text,\s*corrected_at timestamp with time zone\s*\)/,
  );
  assert.match(migration, /SECURITY DEFINER\s*SET search_path = pg_catalog/);
  assert.match(migration, /article\.owner_id = auth\.uid\(\)/);
  assert.match(migration, /article\.status = 'published'/);
  assert.match(migration, /membership\.status = 'active'/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION private\.read_article_correction_disclosure\(uuid\)\s*FROM PUBLIC/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION private\.read_article_correction_disclosure\(uuid\)\s*TO edison_api/,
  );

  const returnShape = migration.match(
    /RETURNS TABLE \([\s\S]*?\)\s*LANGUAGE sql/,
  )?.[0];
  assert.ok(returnShape);
  assert.doesNotMatch(
    returnShape,
    /before_snapshot|after_snapshot|fingerprint|corrected_by/,
  );
});

test("API helper reads only the narrow correction disclosure function", () => {
  const source = readFileSync(
    resolve(
      repositoryRoot,
      "apps/api/src/services/article-corrections.ts",
    ),
    "utf8",
  );

  assert.match(source, /private\.read_article_correction_disclosure/);
  assert.match(source, /correction_note as "note"/);
  assert.match(source, /corrected_at as "correctedAt"/);
  assert.doesNotMatch(
    source,
    /before_snapshot|after_snapshot|fingerprint|corrected_by/,
  );
});

test("disposable database gate is local-only and exercises replay and blockers", () => {
  const source = readFileSync(
    resolve(
      repositoryRoot,
      "scripts/check-article-correction-local-db.ts",
    ),
    "utf8",
  );

  assert.match(source, /"db",\s*"query",\s*"--local"/);
  assert.doesNotMatch(
    source,
    /--linked|--project-ref|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/,
  );
  assert.match(source, /queryFile\(acceptedSql\)[\s\S]*queryFile\(acceptedSql\)/);
  assert.match(source, /article_correction_share_history_exists/);
  assert.match(source, /article_correction_conversation_history_exists/);
  assert.match(source, /article_correction_original_fingerprint_mismatch/);
  assert.match(source, /private\.article_correction_audits/);
});
