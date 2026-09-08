import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  articleBlockSchema,
  articleCategorySchema,
  sourceUrlSchema,
  uuidSchema,
} from "@edison/contracts";
import { z } from "zod";
import { fingerprintRequest } from "../apps/api/src/services/request-fingerprint";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

const correctionSourceSchema = z
  .object({
    id: uuidSchema,
    citation_order: z.number().int().positive(),
    title: z.string().min(1),
    publisher: z.string().min(1),
    url: sourceUrlSchema,
    published_at: timestampSchema.nullable(),
    cited_claims: z.array(z.string()),
  })
  .strict();

export const correctionArticleSpecimenSchema = z
  .object({
    id: uuidSchema,
    category: articleCategorySchema,
    topic: z.string().min(1),
    title: z.string().min(1),
    deck: z.string().min(1),
    body: z.array(articleBlockSchema).min(1),
    summary: z.array(z.string().min(1)).length(3),
    reading_minutes: z.number().int().positive(),
    researched_at: timestampSchema,
    published_at: timestampSchema,
    model: z.string().min(1),
    sources: z.array(correctionSourceSchema).min(1).max(20),
  })
  .strict()
  .superRefine((article, context) => {
    const sourceIds = new Set(article.sources.map((source) => source.id));
    if (sourceIds.size !== article.sources.length) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Article source IDs must be unique.",
      });
    }

    article.sources.forEach((source, index) => {
      if (source.citation_order !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "citation_order"],
          message: "Article source order must be contiguous and one-based.",
        });
      }
    });

    article.body.forEach((block, blockIndex) => {
      if (block.type === "heading") return;
      if (block.citations.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["body", blockIndex, "citations"],
          message: "Every prose block must retain at least one citation.",
        });
      }
      block.citations.forEach((citation, citationIndex) => {
        if (!sourceIds.has(citation.sourceId)) {
          context.addIssue({
            code: "custom",
            path: ["body", blockIndex, "citations", citationIndex, "sourceId"],
            message: "Every citation must reference a retained source ID.",
          });
        }
      });
    });
  });

export type CorrectionArticleSpecimen = z.infer<
  typeof correctionArticleSpecimenSchema
>;

export type CorrectionIdentity = {
  articleId: string;
  ownerId: string;
  sourceIds: readonly string[];
  originalSha256: string;
  correctedSha256: string;
  idempotencyKey: string;
  correctedBy: string;
  correctionNote: string;
};

export type ValidatedCorrection = {
  identity: CorrectionIdentity;
  original: CorrectionArticleSpecimen;
  corrected: CorrectionArticleSpecimen;
  requestFingerprint: string;
};

const defaultArtifactPaths = {
  original: "/private/tmp/edison-owner-acceptance.IZP8Kt/article.json",
  corrected:
    "/private/tmp/edison-owner-correction-2026-09-05/article-editorially-corrected-draft.json",
  acceptance:
    "/private/tmp/edison-owner-correction-2026-09-05/editorial-acceptance.md",
  correctionNote:
    "/private/tmp/edison-owner-correction-2026-09-05/correction-note.md",
} as const;

export const acceptedOwnerCorrection = {
  articleId: "e8c579c1-5908-4a10-a88b-e9740da8e9fb",
  ownerId: "5611f8fa-e0dd-460c-ae4d-5fb7dd7bfe83",
  sourceIds: [
    "211112b3-4ec8-495b-9672-a42832047fd2",
    "14bd6a40-e464-4b97-a429-7c3f96466fc0",
    "c7a857c8-74e3-49b1-9b2b-0e01f8cc21dd",
    "8ff789ed-5e3e-4171-8618-578a246aa3e2",
    "c7876c22-43c8-4679-bc07-aa46204890e6",
  ],
  originalSha256:
    "228bff0bf82de5efc354a6f884f6ff6dff470b33539ef0942de8b7ccfa786563",
  correctedSha256:
    "4f30c1ce0338e00259bbb7310e99be2cc7b9ba0fc4e9e837143895c40667152c",
  acceptanceSha256:
    "aa8293ddb2a8d567cc6e20655da20173da88159c37af612d19c090cc6bf1aac7",
  correctionNoteSha256:
    "61ae99081110550a48fe36e4965ffb31bd463c4d432f58c783f9f48c68c0cd5a",
  idempotencyKey: "article-correction.owner-first.v1",
  correctedBy: "chief-of-staff-editorial-acceptance",
  correctionNote:
    "The headline now identifies electricity as an additional bottleneck for AI. Source dates and citation labels have been corrected, and forecasts are dated. The explanation of local grid constraints is unchanged.",
} as const;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function parseSpecimen(bytes: Uint8Array, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  return correctionArticleSpecimenSchema.parse(parsed);
}

function normalizedTimestamp(value: string) {
  return new Date(value).toISOString();
}

function unchangedArticleProvenance(article: CorrectionArticleSpecimen) {
  return {
    id: article.id,
    category: article.category,
    topic: article.topic,
    researchedAt: normalizedTimestamp(article.researched_at),
    publishedAt: normalizedTimestamp(article.published_at),
    model: article.model,
  };
}

function retainedSourceIdentity(source: CorrectionArticleSpecimen["sources"][number]) {
  return {
    id: source.id,
    citationOrder: source.citation_order,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    citedClaims: source.cited_claims,
  };
}

function retainedBodyStructure(article: CorrectionArticleSpecimen) {
  return article.body.map((block) => {
    if (block.type === "heading") return block;
    return {
      type: block.type,
      citationSourceIds: block.citations.map((citation) => citation.sourceId),
    };
  });
}

export function validateCorrectionPair(input: {
  originalBytes: Uint8Array;
  correctedBytes: Uint8Array;
  identity: CorrectionIdentity;
}): ValidatedCorrection {
  const originalHash = sha256(input.originalBytes);
  const correctedHash = sha256(input.correctedBytes);
  invariant(
    originalHash === sha256Schema.parse(input.identity.originalSha256),
    "Original article hash does not match the reviewed specimen.",
  );
  invariant(
    correctedHash === sha256Schema.parse(input.identity.correctedSha256),
    "Corrected article hash does not match the accepted specimen.",
  );

  const original = parseSpecimen(input.originalBytes, "Original article");
  const corrected = parseSpecimen(input.correctedBytes, "Corrected article");
  const articleId = uuidSchema.parse(input.identity.articleId);
  uuidSchema.parse(input.identity.ownerId);
  const sourceIds = input.identity.sourceIds.map((sourceId) =>
    uuidSchema.parse(sourceId),
  );

  invariant(original.id === articleId, "Original article ID is not approved.");
  invariant(corrected.id === articleId, "Corrected article ID changed.");
  invariant(
    isDeepStrictEqual(
      original.sources.map((source) => source.id),
      sourceIds,
    ),
    "Original source IDs or order do not match the approved identity.",
  );
  invariant(
    isDeepStrictEqual(
      corrected.sources.map((source) => source.id),
      sourceIds,
    ),
    "Corrected source IDs or order changed.",
  );
  invariant(
    isDeepStrictEqual(
      unchangedArticleProvenance(original),
      unchangedArticleProvenance(corrected),
    ),
    "The correction changed original article identity or generation provenance.",
  );
  invariant(
    isDeepStrictEqual(
      original.sources.map(retainedSourceIdentity),
      corrected.sources.map(retainedSourceIdentity),
    ),
    "The correction changed source identity, order, URL, title, publisher, or claims.",
  );
  invariant(
    isDeepStrictEqual(
      retainedBodyStructure(original),
      retainedBodyStructure(corrected),
    ),
    "The correction changed heading or citation-source structure.",
  );
  invariant(
    !isDeepStrictEqual(original, corrected),
    "The accepted correction must differ from the original article.",
  );

  const requestFingerprint = fingerprintRequest([
    "article-correction-v1",
    articleId,
    input.identity.ownerId,
    input.identity.idempotencyKey,
    originalHash,
    correctedHash,
    input.identity.correctedBy,
    input.identity.correctionNote,
  ]);

  return { identity: input.identity, original, corrected, requestFingerprint };
}

type CorrectionSnapshot = {
  version: 1;
  article: {
    id: string;
    ownerId: string;
    category: string;
    topic: string;
    title: string;
    deck: string;
    body: CorrectionArticleSpecimen["body"];
    summary: string[];
    readingMinutes: number;
    researchedAt: string;
    publishedAt: string;
    model: string;
  };
  sources: Array<{
    id: string;
    articleId: string;
    citationOrder: number;
    title: string;
    publisher: string;
    url: string;
    publishedAt: string | null;
    citedClaims: string[];
  }>;
};

export function toCorrectionSnapshot(
  article: CorrectionArticleSpecimen,
  ownerId: string,
): CorrectionSnapshot {
  return {
    version: 1,
    article: {
      id: article.id,
      ownerId,
      category: article.category,
      topic: article.topic,
      title: article.title,
      deck: article.deck,
      body: article.body,
      summary: article.summary,
      readingMinutes: article.reading_minutes,
      researchedAt: normalizedTimestamp(article.researched_at),
      publishedAt: normalizedTimestamp(article.published_at),
      model: article.model,
    },
    sources: article.sources.map((source) => ({
      id: source.id,
      articleId: article.id,
      citationOrder: source.citation_order,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      publishedAt:
        source.published_at === null
          ? null
          : normalizedTimestamp(source.published_at),
      citedClaims: source.cited_claims,
    })),
  };
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlJson(value: unknown) {
  return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

function sqlTimestamp(value: string | null) {
  return value === null
    ? "NULL::timestamp with time zone"
    : `${sqlLiteral(normalizedTimestamp(value))}::timestamp with time zone`;
}

function currentSnapshotSelect(articleId: string, ownerId: string) {
  return `SELECT jsonb_build_object(
    'version', 1,
    'article', jsonb_build_object(
      'id', article.id::text,
      'ownerId', article.owner_id::text,
      'category', article.category::text,
      'topic', article.topic,
      'title', article.title,
      'deck', article.deck,
      'body', article.body,
      'summary', article.summary,
      'readingMinutes', article.reading_minutes,
      'researchedAt', to_char(
        article.researched_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'publishedAt', to_char(
        article.published_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'model', article.model
    ),
    'sources', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', source.id::text,
          'articleId', source.article_id::text,
          'citationOrder', source.citation_order,
          'title', source.title,
          'publisher', source.publisher,
          'url', source.url,
          'publishedAt', CASE
            WHEN source.published_at IS NULL THEN NULL
            ELSE to_char(
              source.published_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          END,
          'citedClaims', source.cited_claims
        )
        ORDER BY source.citation_order
      )
      FROM public.article_sources AS source
      WHERE source.article_id = article.id
    ), '[]'::jsonb)
  )
  INTO current_snapshot
  FROM public.articles AS article
  WHERE article.id = ${sqlLiteral(articleId)}::uuid
    AND article.owner_id = ${sqlLiteral(ownerId)}::uuid`;
}

export function buildCorrectionSql(correction: ValidatedCorrection) {
  const { identity, original, corrected, requestFingerprint } = correction;
  const expectedBefore = toCorrectionSnapshot(original, identity.ownerId);
  const expectedAfter = toCorrectionSnapshot(corrected, identity.ownerId);
  const sourceValues = corrected.sources
    .map(
      (source) =>
        `    (${sqlLiteral(source.id)}::uuid, ${sqlTimestamp(source.published_at)})`,
    )
    .join(",\n");
  const snapshotSelect = currentSnapshotSelect(
    identity.articleId,
    identity.ownerId,
  );

  return `-- Prepared locally from hash-pinned private editorial artifacts.
-- Contains private article content: keep this 0600 file under /private/tmp.
-- No credentials are embedded. Review, then execute once through an approved
-- authenticated Supabase native SQL query session. This is one atomic statement.

DO $article_correction$
DECLARE
  expected_before constant jsonb := ${sqlJson(expectedBefore)};
  expected_after constant jsonb := ${sqlJson(expectedAfter)};
  current_snapshot jsonb;
  current_fingerprint text;
  expected_original_fingerprint text;
  corrected_fingerprint text;
  current_status text;
  affected_count integer;
  existing_audit private.article_correction_audits%ROWTYPE;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '30s', true);

  PERFORM pg_advisory_xact_lock(
    hashtextextended(${sqlLiteral(`article-correction:${identity.articleId}`)}, 0)
  );

  SELECT article.status::text
  INTO current_status
  FROM public.articles AS article
  WHERE article.id = ${sqlLiteral(identity.articleId)}::uuid
    AND article.owner_id = ${sqlLiteral(identity.ownerId)}::uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'article_correction_target_not_found'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.article_sources AS source
  WHERE source.article_id = ${sqlLiteral(identity.articleId)}::uuid
  ORDER BY source.id
  FOR UPDATE;

  ${snapshotSelect};
  expected_original_fingerprint :=
    private.article_correction_snapshot_fingerprint(expected_before);
  corrected_fingerprint :=
    private.article_correction_snapshot_fingerprint(expected_after);
  current_fingerprint :=
    private.article_correction_snapshot_fingerprint(current_snapshot);

  SELECT audit.*
  INTO existing_audit
  FROM private.article_correction_audits AS audit
  WHERE audit.owner_id = ${sqlLiteral(identity.ownerId)}::uuid
    AND audit.idempotency_key = ${sqlLiteral(identity.idempotencyKey)}
  FOR SHARE;

  IF FOUND THEN
    IF existing_audit.article_id <> ${sqlLiteral(identity.articleId)}::uuid
      OR existing_audit.request_fingerprint <> ${sqlLiteral(requestFingerprint)}
      OR existing_audit.original_artifact_sha256 <> ${sqlLiteral(identity.originalSha256)}
      OR existing_audit.corrected_artifact_sha256 <> ${sqlLiteral(identity.correctedSha256)}
      OR existing_audit.expected_original_fingerprint <> expected_original_fingerprint
      OR existing_audit.corrected_fingerprint <> corrected_fingerprint
      OR existing_audit.before_snapshot IS DISTINCT FROM expected_before
      OR existing_audit.after_snapshot IS DISTINCT FROM expected_after
    THEN
      RAISE EXCEPTION 'article_correction_idempotency_conflict'
        USING ERRCODE = 'P0001';
    END IF;

    IF current_snapshot IS DISTINCT FROM existing_audit.after_snapshot
      OR current_fingerprint <> existing_audit.corrected_fingerprint
    THEN
      RAISE EXCEPTION 'article_correction_replay_target_changed'
        USING ERRCODE = 'P0001';
    END IF;

    RAISE NOTICE 'article correction already applied with identical inputs';
    RETURN;
  END IF;

  IF current_status <> 'published' THEN
    RAISE EXCEPTION 'article_correction_target_not_published'
      USING ERRCODE = 'P0001';
  END IF;

  IF current_snapshot IS DISTINCT FROM expected_before
    OR current_fingerprint <> expected_original_fingerprint
  THEN
    RAISE EXCEPTION 'article_correction_original_fingerprint_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.article_shares AS share_record
    WHERE share_record.article_id = ${sqlLiteral(identity.articleId)}::uuid
  ) THEN
    RAISE EXCEPTION 'article_correction_share_history_exists'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.article_conversations AS conversation
    WHERE conversation.article_id = ${sqlLiteral(identity.articleId)}::uuid
  ) THEN
    RAISE EXCEPTION 'article_correction_conversation_history_exists'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.articles
  SET
    title = ${sqlLiteral(corrected.title)},
    deck = ${sqlLiteral(corrected.deck)},
    body = ${sqlJson(corrected.body)},
    summary = ${sqlJson(corrected.summary)},
    reading_minutes = ${corrected.reading_minutes},
    updated_at = clock_timestamp()
  WHERE id = ${sqlLiteral(identity.articleId)}::uuid
    AND owner_id = ${sqlLiteral(identity.ownerId)}::uuid;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 1 THEN
    RAISE EXCEPTION 'article_correction_article_update_failed'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.article_sources AS source
  SET published_at = accepted_source.published_at
  FROM (VALUES
${sourceValues}
  ) AS accepted_source(id, published_at)
  WHERE source.article_id = ${sqlLiteral(identity.articleId)}::uuid
    AND source.id = accepted_source.id;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> ${corrected.sources.length} THEN
    RAISE EXCEPTION 'article_correction_source_update_failed'
      USING ERRCODE = 'P0001';
  END IF;

  ${snapshotSelect};
  current_fingerprint :=
    private.article_correction_snapshot_fingerprint(current_snapshot);

  IF current_snapshot IS DISTINCT FROM expected_after
    OR current_fingerprint <> corrected_fingerprint
  THEN
    RAISE EXCEPTION 'article_correction_result_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO private.article_correction_audits (
    article_id,
    owner_id,
    idempotency_key,
    request_fingerprint,
    original_artifact_sha256,
    corrected_artifact_sha256,
    expected_original_fingerprint,
    corrected_fingerprint,
    before_snapshot,
    after_snapshot,
    corrected_by,
    correction_note
  )
  VALUES (
    ${sqlLiteral(identity.articleId)}::uuid,
    ${sqlLiteral(identity.ownerId)}::uuid,
    ${sqlLiteral(identity.idempotencyKey)},
    ${sqlLiteral(requestFingerprint)},
    ${sqlLiteral(identity.originalSha256)},
    ${sqlLiteral(identity.correctedSha256)},
    expected_original_fingerprint,
    corrected_fingerprint,
    expected_before,
    expected_after,
    ${sqlLiteral(identity.correctedBy)},
    ${sqlLiteral(identity.correctionNote)}
  );
END;
$article_correction$;
`;
}

export function buildCorrectionResultSql(correction: ValidatedCorrection) {
  const { identity } = correction;
  return `SELECT jsonb_build_object(
  'articleId', audit.article_id,
  'correctedAt', audit.corrected_at,
  'correctedArtifactSha256', audit.corrected_artifact_sha256
) AS correction_result
FROM private.article_correction_audits AS audit
WHERE audit.owner_id = ${sqlLiteral(identity.ownerId)}::uuid
  AND audit.idempotency_key = ${sqlLiteral(identity.idempotencyKey)};
`;
}

type ArtifactPaths = {
  original: string;
  corrected: string;
  acceptance: string;
  correctionNote: string;
};

export function loadAcceptedOwnerCorrection(
  paths: ArtifactPaths = defaultArtifactPaths,
) {
  const originalBytes = readFileSync(resolve(paths.original));
  const correctedBytes = readFileSync(resolve(paths.corrected));
  const acceptanceBytes = readFileSync(resolve(paths.acceptance));
  const correctionNoteBytes = readFileSync(resolve(paths.correctionNote));

  invariant(
    sha256(acceptanceBytes) === acceptedOwnerCorrection.acceptanceSha256,
    "Editorial acceptance hash does not match the approved record.",
  );
  invariant(
    sha256(correctionNoteBytes) === acceptedOwnerCorrection.correctionNoteSha256,
    "Correction-note hash does not match the reviewed record.",
  );

  return validateCorrectionPair({
    originalBytes,
    correctedBytes,
    identity: acceptedOwnerCorrection,
  });
}

function writePrivateTempFile(path: string, contents: string) {
  const outputPath = resolve(path);
  invariant(
    outputPath.startsWith("/private/tmp/"),
    "Correction SQL must be written under /private/tmp.",
  );
  invariant(
    !existsSync(outputPath),
    `Refusing to overwrite existing output: ${outputPath}`,
  );
  writeFileSync(outputPath, contents, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return outputPath;
}

function usage() {
  return [
    "Usage:",
    "  pnpm article-correction",
    "  pnpm article-correction --emit-sql /private/tmp/<new-file>.sql",
    "  pnpm article-correction --emit-result-sql /private/tmp/<new-file>.sql",
    "",
    "The default validates the exact accepted private artifacts only.",
    "This tool never reads credentials or connects to an API or database.",
  ].join("\n");
}

export function runArticleCorrectionCli(args: string[]) {
  if (args.length === 1 && args[0] === "--help") return usage();
  const correction = loadAcceptedOwnerCorrection();

  if (args.length === 0) {
    return `Validated accepted correction for article ${correction.identity.articleId}; no external action taken.`;
  }

  if (args.length === 2 && args[0] === "--emit-sql") {
    const outputPath = writePrivateTempFile(
      args[1]!,
      buildCorrectionSql(correction),
    );
    return `Wrote reviewed correction SQL to ${outputPath}; no external action taken.`;
  }

  if (args.length === 2 && args[0] === "--emit-result-sql") {
    const outputPath = writePrivateTempFile(
      args[1]!,
      buildCorrectionResultSql(correction),
    );
    return `Wrote the private correction-result read SQL to ${outputPath}; no external action taken.`;
  }

  throw new Error(usage());
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    console.log(runArticleCorrectionCli(process.argv.slice(2)));
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Article correction validation failed.",
    );
    process.exitCode = 1;
  }
}
