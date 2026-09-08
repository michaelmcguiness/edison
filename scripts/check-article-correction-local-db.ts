import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCorrectionResultSql,
  buildCorrectionSql,
  sha256,
  validateCorrectionPair,
  type CorrectionIdentity,
  type ValidatedCorrection,
} from "./article-correction";

// Intentionally no linked/project/URL option: this gate only uses disposable
// CI Postgres through the Supabase CLI's explicit --local boundary.
const localQueryArgs = [
  "exec",
  "supabase",
  "db",
  "query",
  "--local",
  "--agent",
  "no",
  "--output-format",
  "json",
];

function parseRows(output: string) {
  const match = /(^|\n)\s*\[/.exec(output);
  if (!match) {
    const prefix = output.trim().replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      `The local generic-fixture SELECT did not return JSON. Output prefix: ${JSON.stringify(prefix)}`,
    );
  }
  const start = output.indexOf("[", match.index);
  return JSON.parse(output.slice(start)) as Record<string, unknown>[];
}

function execute(args: string[]) {
  return execFileSync("pnpm", [...localQueryArgs, ...args], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
}

function query(args: string[]) {
  return parseRows(execute(args));
}

function queryFile(path: string) {
  execute(["--file", path]);
}

function expectQueryFileFailure(path: string, expectedCode: string) {
  const result = spawnSync("pnpm", [...localQueryArgs, "--file", path], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.notEqual(result.status, 0, `Expected ${expectedCode} to fail.`);
  assert.match(
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    new RegExp(expectedCode),
  );
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function makeGenericCorrection(
  ownerId: string,
  articleId: string,
  sourceId: string,
  suffix: string,
) {
  const original = {
    id: articleId,
    category: "tech-science",
    topic: `Generic topic ${suffix}`,
    title: `Original generic title ${suffix}`,
    deck: `Original generic deck ${suffix}.`,
    body: [
      {
        type: "paragraph",
        text: `Original generic paragraph ${suffix}.`,
        citations: [{ sourceId, label: "Generic source" }],
      },
    ],
    summary: [
      `Original generic point ${suffix}.`,
      "Stable generic point two.",
      "Stable generic point three.",
    ],
    reading_minutes: 3,
    researched_at: "2026-09-05T12:00:00.000Z",
    published_at: "2026-09-05T12:00:00.000Z",
    model: "generic-test-model",
    sources: [
      {
        id: sourceId,
        citation_order: 1,
        title: `Generic source ${suffix}`,
        publisher: "Generic publisher",
        url: `https://example.com/${suffix}`,
        published_at: "2026-01-01T00:00:00.000Z",
        cited_claims: [],
      },
    ],
  };
  const corrected = structuredClone(original);
  corrected.title = `Corrected generic title ${suffix}`;
  corrected.deck = `Corrected generic deck ${suffix}.`;
  corrected.body[0]!.text = `Corrected generic paragraph ${suffix}.`;
  corrected.body[0]!.citations[0]!.label = "Accurate source";
  corrected.summary[0] = `Corrected generic point ${suffix}.`;
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
    idempotencyKey: `article-correction.ci.${suffix}`,
    correctedBy: "ci-reviewed-editor",
    correctionNote: `Generic correction disclosure ${suffix}.`,
  };
  return validateCorrectionPair({ originalBytes, correctedBytes, identity });
}

function setupArticle(correction: ValidatedCorrection, slug: string) {
  const { original, identity } = correction;
  const source = original.sources[0]!;
  execute([
    `INSERT INTO public.articles (
      id, owner_id, slug, status, category, kicker, topic, title, deck, body,
      summary, why_written, reading_minutes, source_count, researched_at,
      published_at, model
    ) VALUES (
      ${sqlLiteral(identity.articleId)}::uuid,
      ${sqlLiteral(identity.ownerId)}::uuid,
      ${sqlLiteral(slug)},
      'published',
      ${sqlLiteral(original.category)}::public.content_category,
      'Generic test',
      ${sqlLiteral(original.topic)},
      ${sqlLiteral(original.title)},
      ${sqlLiteral(original.deck)},
      ${sqlLiteral(JSON.stringify(original.body))}::jsonb,
      ${sqlLiteral(JSON.stringify(original.summary))}::jsonb,
      'Disposable correction gate',
      ${original.reading_minutes},
      1,
      ${sqlLiteral(original.researched_at)}::timestamp with time zone,
      ${sqlLiteral(original.published_at)}::timestamp with time zone,
      ${sqlLiteral(original.model)}
    );`,
  ]);
  execute([
    `INSERT INTO public.article_sources (
      id, article_id, citation_order, title, publisher, url, published_at,
      accessed_at, cited_claims
    ) VALUES (
      ${sqlLiteral(source.id)}::uuid,
      ${sqlLiteral(identity.articleId)}::uuid,
      ${source.citation_order},
      ${sqlLiteral(source.title)},
      ${sqlLiteral(source.publisher)},
      ${sqlLiteral(source.url)},
      ${sqlLiteral(source.published_at!)}::timestamp with time zone,
      '2026-09-05T12:00:00Z'::timestamp with time zone,
      ${sqlLiteral(JSON.stringify(source.cited_claims))}::jsonb
    );`,
  ]);
}

function writeSql(tempDirectory: string, name: string, sql: string) {
  const path = join(tempDirectory, `${name}.sql`);
  writeFileSync(path, sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return path;
}

const ownerId = crypto.randomUUID();
const tempDirectory = mkdtempSync(join(tmpdir(), "edison-correction-ci-"));

try {
  execute([
    `INSERT INTO auth.users (id, email)
     VALUES (${sqlLiteral(ownerId)}::uuid, ${sqlLiteral(`correction-${ownerId}@edison.test`)});`,
  ]);

  const accepted = makeGenericCorrection(
    ownerId,
    crypto.randomUUID(),
    crypto.randomUUID(),
    "accepted",
  );
  setupArticle(accepted, `generic-accepted-${accepted.identity.articleId}`);
  const acceptedSql = writeSql(
    tempDirectory,
    "accepted",
    buildCorrectionSql(accepted),
  );
  queryFile(acceptedSql);
  const first = query([buildCorrectionResultSql(accepted)]);
  queryFile(acceptedSql);
  const replay = query([buildCorrectionResultSql(accepted)]);
  assert.deepEqual(replay, first);

  const applied = query([
    `SELECT
       article.title,
       article.reading_minutes,
       source.published_at,
       audit.original_artifact_sha256,
       audit.corrected_artifact_sha256,
       audit.before_snapshot,
       audit.after_snapshot
     FROM public.articles AS article
     JOIN public.article_sources AS source ON source.article_id = article.id
     JOIN private.article_correction_audits AS audit ON audit.article_id = article.id
     WHERE article.id = ${sqlLiteral(accepted.identity.articleId)}::uuid;`,
  ]);
  assert.equal(applied.length, 1);
  assert.equal(applied[0]!.title, accepted.corrected.title);
  assert.equal(applied[0]!.reading_minutes, accepted.corrected.reading_minutes);
  assert.equal(
    applied[0]!.original_artifact_sha256,
    accepted.identity.originalSha256,
  );
  assert.equal(
    applied[0]!.corrected_artifact_sha256,
    accepted.identity.correctedSha256,
  );
  assert.notDeepEqual(
    applied[0]!.before_snapshot,
    applied[0]!.after_snapshot,
  );

  const withShare = makeGenericCorrection(
    ownerId,
    crypto.randomUUID(),
    crypto.randomUUID(),
    "share",
  );
  setupArticle(withShare, `generic-share-${withShare.identity.articleId}`);
  execute([
    `INSERT INTO public.article_shares (
       article_id, user_id, slug, snapshot
     ) VALUES (
       ${sqlLiteral(withShare.identity.articleId)}::uuid,
       ${sqlLiteral(ownerId)}::uuid,
       ${sqlLiteral(sha256(withShare.identity.articleId).slice(0, 32))},
       '{"version":1,"generic":true}'::jsonb
     );`,
  ]);
  const shareSql = writeSql(
    tempDirectory,
    "share",
    buildCorrectionSql(withShare),
  );
  expectQueryFileFailure(shareSql, "article_correction_share_history_exists");

  const withConversation = makeGenericCorrection(
    ownerId,
    crypto.randomUUID(),
    crypto.randomUUID(),
    "conversation",
  );
  setupArticle(
    withConversation,
    `generic-conversation-${withConversation.identity.articleId}`,
  );
  execute([
    `INSERT INTO public.article_conversations (user_id, article_id, title)
     VALUES (
       ${sqlLiteral(ownerId)}::uuid,
       ${sqlLiteral(withConversation.identity.articleId)}::uuid,
       'Generic conversation'
     );`,
  ]);
  const conversationSql = writeSql(
    tempDirectory,
    "conversation",
    buildCorrectionSql(withConversation),
  );
  expectQueryFileFailure(
    conversationSql,
    "article_correction_conversation_history_exists",
  );

  const changedOriginal = makeGenericCorrection(
    ownerId,
    crypto.randomUUID(),
    crypto.randomUUID(),
    "changed",
  );
  setupArticle(
    changedOriginal,
    `generic-changed-${changedOriginal.identity.articleId}`,
  );
  execute([
    `UPDATE public.articles
     SET title = 'Unexpected concurrent title'
     WHERE id = ${sqlLiteral(changedOriginal.identity.articleId)}::uuid;`,
  ]);
  const changedSql = writeSql(
    tempDirectory,
    "changed",
    buildCorrectionSql(changedOriginal),
  );
  expectQueryFileFailure(
    changedSql,
    "article_correction_original_fingerprint_mismatch",
  );

  const blocked = query([
    `SELECT
       (SELECT count(*)::integer
        FROM private.article_correction_audits
        WHERE article_id IN (
          ${sqlLiteral(withShare.identity.articleId)}::uuid,
          ${sqlLiteral(withConversation.identity.articleId)}::uuid,
          ${sqlLiteral(changedOriginal.identity.articleId)}::uuid
        )) AS audit_count,
       (SELECT count(*)::integer
        FROM public.articles
        WHERE id IN (
          ${sqlLiteral(withShare.identity.articleId)}::uuid,
          ${sqlLiteral(withConversation.identity.articleId)}::uuid
        )
          AND title LIKE 'Original generic title%') AS unchanged_count;`,
  ]);
  assert.deepEqual(blocked, [{ audit_count: 0, unchanged_count: 2 }]);

  console.log(
    "Disposable database: correction applied once, exact replay held, and share/conversation/original-drift preconditions failed closed.",
  );
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}
