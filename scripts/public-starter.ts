import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  publicStarterEditionSchema,
  publishPublicStarterEditionRequestSchema,
  sharedArticleSnapshotSchema,
  type PublicStarterEdition,
  type PublishPublicStarterEditionRequest,
} from "@edison/contracts";
import { z } from "zod";
import { fingerprintRequest } from "../apps/api/src/services/request-fingerprint";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const publicStarterFixturePath = resolve(
  repositoryRoot,
  "content/public-starters/accepted-sleep-history-v1.json",
);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const contentIdSchema = z.enum(["sleep-attention", "longitude"]);
const subjectIdSchema = z.enum(["sleep", "history"]);

const sourceDocumentSchema = z
  .object({
    path: z.string().min(1),
    sha256: sha256Schema,
    bytes: z.number().int().positive(),
  })
  .strict();

const subjectSchema = z
  .object({
    id: subjectIdSchema,
    label: z.string().min(1),
    direction: z.string().min(1),
    articleContentIds: z.array(contentIdSchema).min(1),
  })
  .strict();

const fixtureItemSchema = z
  .object({
    contentId: contentIdSchema,
    subjectId: subjectIdSchema,
    reason: z.string().trim().min(1).max(500),
    sourceDocument: sourceDocumentSchema,
    snapshotSha256: sha256Schema,
    article: sharedArticleSnapshotSchema,
  })
  .strict();

export const publicStarterFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    fixtureId: z.literal("accepted-sleep-history-v1"),
    edition: z
      .object({
        editionDate: z.string().date(),
        label: z.string().trim().min(1).max(120),
        idempotencyKey: z.string().trim().min(8).max(128),
        requestFingerprint: sha256Schema,
      })
      .strict(),
    approval: z
      .object({
        handoffPath: z.string().min(1),
        prohibitedArticleFingerprint: sha256Schema,
        prohibitedFingerprintKind: z.literal("lost-request-json"),
      })
      .strict(),
    subjects: z.array(subjectSchema).length(2),
    items: z.array(fixtureItemSchema).length(2),
  })
  .strict();

export type PublicStarterFixture = z.infer<typeof publicStarterFixtureSchema>;

const expectedApproval = {
  handoffPath:
    "docs/brand/APPROVED_PULSE_LOOPS_CTO_HANDOFF_2026-09-05.md",
  prohibitedArticleFingerprint:
    "aa26d2258cb391ad552466f39bee01ae4d1596d480fef59381dfeb9b184d8c50",
  prohibitedFingerprintKind: "lost-request-json",
} as const;

const expectedSubjects = [
  {
    id: "sleep",
    label: "Sleep",
    direction: "Understand sleep, attention and recovery.",
    articleContentIds: ["sleep-attention"],
  },
  {
    id: "history",
    label: "History",
    direction: "Explore how ideas and inventions changed everyday life.",
    articleContentIds: ["longitude"],
  },
] as const;

const expectedItems = [
  {
    contentId: "sleep-attention",
    subjectId: "sleep",
    sourcePath:
      "docs/editorial/audience-research-2026-09-05/HEALTH_ARTICLE.md",
    sourceSha256:
      "9ced5cc067151e4f31406b6fa5bcf078d386af11969b85605b64583a0643e8f1",
    sourceBytes: 4309,
  },
  {
    contentId: "longitude",
    subjectId: "history",
    sourcePath: "docs/editorial/starter/ARTICLE.md",
    sourceSha256:
      "b7a8b5674625f2d694998b4497d9c1049f6d4387721f12a09896c8a6ed42dbae",
    sourceBytes: 8905,
  },
] as const;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function deterministicSourceId(url: string) {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`edison-public-source-v1:${url}`)
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type ParsedMarkdownBlock = {
  type: "paragraph" | "heading";
  text: string;
  level?: 2;
  inlineCitationUrls: string[];
};

type ParsedMarkdownArticle = {
  title: string;
  deck: string;
  body: ParsedMarkdownBlock[];
  summary: string[];
  linkedUrls: string[];
  sourceRecords: Array<{ title: string; publisher: string; url: string }>;
};

function markdownLinks(value: string) {
  return Array.from(
    value.matchAll(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g),
    (match) => ({ label: match[1]!, url: match[2]! }),
  );
}

function plainInlineMarkdown(value: string) {
  return value
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function parseAcceptedMarkdown(markdown: string): ParsedMarkdownArticle {
  const normalized = markdown.replaceAll("\r\n", "\n");
  const divider = normalized.indexOf("\n---\n");
  const readerSection = divider >= 0 ? normalized.slice(0, divider) : normalized;
  const appendix = divider >= 0 ? normalized.slice(divider + 5) : "";
  const sections = readerSection
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  invariant(sections[0]?.startsWith("# "), "Accepted Markdown needs one title.");
  const title = sections.shift()!.slice(2).trim();
  invariant(sections.length > 0, "Accepted Markdown needs a deck.");
  const deck = plainInlineMarkdown(sections.shift()!);
  if (sections[0]?.startsWith("*Edison ·")) sections.shift();

  const body = sections.map((section): ParsedMarkdownBlock => {
    if (section.startsWith("## ")) {
      return {
        type: "heading",
        level: 2,
        text: section.slice(3).trim(),
        inlineCitationUrls: [],
      };
    }
    invariant(
      !section.startsWith("#") && !section.startsWith("- "),
      "Accepted reader prose contains an unsupported Markdown block.",
    );
    return {
      type: "paragraph",
      text: plainInlineMarkdown(section.replaceAll("\n", " ")),
      inlineCitationUrls: markdownLinks(section).map((link) => link.url),
    };
  });

  const summaryMatch = appendix.match(
    /\*\*Three takeaways\*\*\s*\n\s*([\s\S]*?)(?:\n\s*\*\*Sources\*\*|$)/,
  );
  const summary = summaryMatch
    ? summaryMatch[1]!
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => plainInlineMarkdown(line.slice(2)))
    : [];

  const sourceRecords = appendix
    .split("\n")
    .map((line) =>
      line
        .trim()
        .match(/^- \[([^\]]+)]\((https?:\/\/[^)]+)\) — (.+)$/),
    )
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      title: match[1]!,
      url: match[2]!,
      publisher: match[3]!,
    }));

  return {
    title,
    deck,
    body,
    summary,
    linkedUrls: Array.from(
      new Set(markdownLinks(normalized).map((link) => link.url)),
    ),
    sourceRecords,
  };
}

export function toPublicationRequest(
  fixture: PublicStarterFixture,
): PublishPublicStarterEditionRequest {
  return publishPublicStarterEditionRequestSchema.parse({
    editionDate: fixture.edition.editionDate,
    label: fixture.edition.label,
    idempotencyKey: fixture.edition.idempotencyKey,
    items: fixture.items.map((item) => ({
      reason: item.reason,
      article: item.article,
    })),
  });
}

function verifyAcceptedSource(
  fixtureItem: PublicStarterFixture["items"][number],
  expected: (typeof expectedItems)[number],
  sourceRoot: string,
) {
  invariant(
    fixtureItem.contentId === expected.contentId &&
      fixtureItem.subjectId === expected.subjectId,
    `Starter position must remain ${expected.contentId}/${expected.subjectId}.`,
  );
  invariant(
    fixtureItem.sourceDocument.path === expected.sourcePath &&
      fixtureItem.sourceDocument.sha256 === expected.sourceSha256 &&
      fixtureItem.sourceDocument.bytes === expected.sourceBytes,
    `${expected.contentId} must retain its accepted source identity.`,
  );

  const source = readFileSync(resolve(sourceRoot, expected.sourcePath));
  invariant(
    source.byteLength === expected.sourceBytes,
    `${expected.contentId} accepted Markdown byte length changed.`,
  );
  invariant(
    sha256(source) === expected.sourceSha256,
    `${expected.contentId} accepted Markdown fingerprint changed.`,
  );

  const parsed = parseAcceptedMarkdown(source.toString("utf8"));
  invariant(
    fixtureItem.article.title === parsed.title &&
      fixtureItem.article.deck === parsed.deck,
    `${expected.contentId} title or deck diverges from accepted Markdown.`,
  );

  const comparableFixtureBody = fixtureItem.article.body.map((block) =>
    block.type === "heading"
      ? { type: block.type, level: block.level, text: block.text }
      : { type: block.type, text: block.text },
  );
  const comparableAcceptedBody = parsed.body.map((block) =>
    block.type === "heading"
      ? { type: block.type, level: block.level, text: block.text }
      : { type: block.type, text: block.text },
  );
  invariant(
    isDeepStrictEqual(comparableFixtureBody, comparableAcceptedBody),
    `${expected.contentId} reader body diverges from accepted Markdown.`,
  );

  if (parsed.summary.length > 0) {
    invariant(
      isDeepStrictEqual(fixtureItem.article.summary, parsed.summary),
      `${expected.contentId} takeaways diverge from accepted Markdown.`,
    );
  } else {
    const acceptedBody = parsed.body.map((block) => block.text).join(" ");
    invariant(
      fixtureItem.article.summary.every((takeaway) =>
        acceptedBody.includes(takeaway),
      ),
      `${expected.contentId} summary must use statements already accepted in the body.`,
    );
  }

  const sourceById = new Map(
    fixtureItem.article.sources.map((articleSource) => [
      articleSource.id,
      articleSource,
    ]),
  );
  const fixtureUrls = fixtureItem.article.sources.map((articleSource) =>
    articleSource.url,
  );
  invariant(
    isDeepStrictEqual([...fixtureUrls].sort(), [...parsed.linkedUrls].sort()),
    `${expected.contentId} source URLs diverge from accepted Markdown.`,
  );
  for (const articleSource of fixtureItem.article.sources) {
    invariant(
      articleSource.id === deterministicSourceId(articleSource.url),
      `${expected.contentId} source IDs must be deterministic from canonical URLs.`,
    );
  }
  for (const sourceRecord of parsed.sourceRecords) {
    const articleSource = fixtureItem.article.sources.find(
      (candidate) => candidate.url === sourceRecord.url,
    );
    invariant(
      articleSource?.title === sourceRecord.title &&
        articleSource.publisher === sourceRecord.publisher,
      `${expected.contentId} source record diverges from accepted Markdown.`,
    );
  }

  parsed.body.forEach((block, index) => {
    if (block.type === "heading") return;
    const fixtureBlock = fixtureItem.article.body[index];
    invariant(
      fixtureBlock?.type === "paragraph",
      `${expected.contentId} citation position changed.`,
    );
    const citedUrls = new Set(
      fixtureBlock.citations.map((citation) => {
        const citedSource = sourceById.get(citation.sourceId);
        invariant(
          citedSource,
          `${expected.contentId} citation references a missing source.`,
        );
        return citedSource.url;
      }),
    );
    invariant(
      block.inlineCitationUrls.every((url) => citedUrls.has(url)),
      `${expected.contentId} dropped an accepted inline citation.`,
    );
  });

  invariant(
    fixtureItem.snapshotSha256 ===
      sha256(JSON.stringify(sharedArticleSnapshotSchema.parse(fixtureItem.article))),
    `${expected.contentId} snapshot fingerprint changed.`,
  );
}

export function validatePublicStarterFixtureData(
  input: unknown,
  sourceRoot = repositoryRoot,
) {
  const fixture = publicStarterFixtureSchema.parse(input);
  invariant(
    isDeepStrictEqual(fixture.approval, expectedApproval),
    "The accepted handoff or prohibited lost-JSON fingerprint changed.",
  );
  invariant(
    isDeepStrictEqual(fixture.subjects, expectedSubjects),
    "The approved Sleep/History subject manifest changed.",
  );
  invariant(
    fixture.items.every(
      (item) =>
        item.sourceDocument.sha256 !==
          fixture.approval.prohibitedArticleFingerprint &&
        item.snapshotSha256 !== fixture.approval.prohibitedArticleFingerprint,
    ),
    "The lost request-JSON fingerprint cannot identify accepted article content.",
  );

  fixture.items.forEach((item, index) => {
    verifyAcceptedSource(item, expectedItems[index]!, sourceRoot);
  });

  const request = toPublicationRequest(fixture);
  const calculatedFingerprint = fingerprintRequest([
    "publish-public-news-edition",
    request.editionDate,
    request.label,
    request.items,
  ]);
  invariant(
    fixture.edition.requestFingerprint === calculatedFingerprint,
    "Starter publication request fingerprint changed.",
  );
  return fixture;
}

export function loadPublicStarterFixture() {
  return validatePublicStarterFixtureData(
    JSON.parse(readFileSync(publicStarterFixturePath, "utf8")) as unknown,
  );
}

function sqlLiteral(value: string) {
  invariant(!value.includes("\0"), "SQL text cannot contain a null byte.");
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildPublicationSql(fixture: PublicStarterFixture) {
  const request = toPublicationRequest(fixture);
  const rows = request.items
    .map(
      (item, index) =>
        `    (new_edition_id, ${index + 1}, ${sqlLiteral(item.reason)}, ${sqlLiteral(JSON.stringify(item.article))}::jsonb)`,
    )
    .join(",\n");
  const editionDate = sqlLiteral(request.editionDate);
  const idempotencyKey = sqlLiteral(request.idempotencyKey);
  const requestFingerprint = sqlLiteral(fixture.edition.requestFingerprint);

  return `-- Generated from content/public-starters/accepted-sleep-history-v1.json.
-- PREPARED ONLY: contains public article content and no credentials.
-- Review before running against the exact linked Supabase project. This script
-- is one atomic native-query statement, mirrors the application publication
-- boundary, and never overwrites existing data.

DO $edison_public_starter$
DECLARE
  existing_edition public.public_starter_editions%ROWTYPE;
  new_edition_id uuid;
BEGIN
  IF ${editionDate}::date > (clock_timestamp() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'starter_edition_date_in_future' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(${sqlLiteral(`public-starter-key:${request.idempotencyKey}`)}, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(${sqlLiteral(`public-starter-date:news:${request.editionDate}`)}, 0));

  SELECT *
  INTO existing_edition
  FROM public.public_starter_editions
  WHERE idempotency_key = ${idempotencyKey}
  FOR UPDATE;

  IF existing_edition.id IS NOT NULL THEN
    IF existing_edition.request_fingerprint <> ${requestFingerprint} THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = 'P0001';
    END IF;
    IF existing_edition.status <> 'published' THEN
      RAISE EXCEPTION 'starter_edition_publication_incomplete' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.public_starter_editions
    WHERE section = 'news'
      AND edition_date = ${editionDate}::date
  ) THEN
    RAISE EXCEPTION 'starter_edition_date_exists' USING ERRCODE = 'P0001';
  END IF;

  new_edition_id := gen_random_uuid();
  INSERT INTO public.public_starter_editions (
    id,
    section,
    edition_date,
    label,
    status,
    published_at,
    idempotency_key,
    request_fingerprint
  ) VALUES (
    new_edition_id,
    'news',
    ${editionDate}::date,
    ${sqlLiteral(request.label)},
    'draft',
    NULL,
    ${idempotencyKey},
    ${requestFingerprint}
  );

  INSERT INTO public.public_starter_edition_articles (
    edition_id,
    position,
    reason,
    snapshot
  ) VALUES
${rows};

  UPDATE public.public_starter_editions
  SET status = 'published',
      published_at = clock_timestamp()
  WHERE id = new_edition_id
    AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'starter_edition_publication_failed' USING ERRCODE = 'P0001';
  END IF;
END
$edison_public_starter$;
`;
}

export function buildPublicationReadSql(fixture: PublicStarterFixture) {
  const idempotencyKey = sqlLiteral(fixture.edition.idempotencyKey);
  return `SELECT jsonb_build_object(
  'id', edition.id,
  'section', edition.section,
  'editionDate', edition.edition_date,
  'label', edition.label,
  'publishedAt', to_char(
    edition.published_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ),
  'itemCount', (
    SELECT count(*)::integer
    FROM public.public_starter_edition_articles AS count_item
    WHERE count_item.edition_id = edition.id
  ),
  'items', (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'position', item.position,
          'reason', item.reason,
          'article', item.snapshot
        ) ORDER BY item.position
      ),
      '[]'::jsonb
    )
    FROM public.public_starter_edition_articles AS item
    WHERE item.edition_id = edition.id
  )
) AS public_starter_edition
FROM public.public_starter_editions AS edition
WHERE edition.idempotency_key = ${idempotencyKey};
`;
}

export function bindPublishedSubjectManifest(
  fixture: PublicStarterFixture,
  input: unknown,
) {
  const edition = publicStarterEditionSchema.parse(input);
  invariant(
    edition.editionDate === fixture.edition.editionDate &&
      edition.label === fixture.edition.label &&
      edition.itemCount === fixture.items.length,
    "Published edition identity does not match the accepted fixture.",
  );

  const publicIds = new Set<string>();
  const publicIdByContentId = new Map<string, string>();
  fixture.items.forEach((fixtureItem, index) => {
    const publishedItem = edition.items[index];
    invariant(
      publishedItem?.position === index + 1 &&
        publishedItem.reason === fixtureItem.reason &&
        isDeepStrictEqual(publishedItem.article, fixtureItem.article),
      `Published position ${index + 1} does not match ${fixtureItem.contentId}.`,
    );
    invariant(
      !publicIds.has(publishedItem.id),
      "Published article IDs must be unique.",
    );
    publicIds.add(publishedItem.id);
    publicIdByContentId.set(fixtureItem.contentId, publishedItem.id);
  });

  return {
    schemaVersion: 1 as const,
    fixtureId: fixture.fixtureId,
    requestFingerprint: fixture.edition.requestFingerprint,
    editionId: edition.id,
    editionDate: edition.editionDate,
    publishedAt: edition.publishedAt,
    articles: fixture.items.map((item) => ({
      contentId: item.contentId,
      subjectId: item.subjectId,
      publicArticleId: publicIdByContentId.get(item.contentId)!,
      snapshotSha256: item.snapshotSha256,
    })),
    subjects: fixture.subjects.map((subject) => ({
      id: subject.id,
      label: subject.label,
      direction: subject.direction,
      publicArticleIds: subject.articleContentIds.map((contentId) => {
        const publicArticleId = publicIdByContentId.get(contentId);
        invariant(publicArticleId, `No published ID exists for ${contentId}.`);
        return publicArticleId;
      }),
    })),
  };
}

function writeNewFile(path: string, contents: string) {
  const outputPath = resolve(path);
  invariant(
    !existsSync(outputPath),
    `Refusing to overwrite existing output: ${outputPath}`,
  );
  writeFileSync(outputPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return outputPath;
}

function usage() {
  return [
    "Usage:",
    "  pnpm public-starter",
    "  pnpm public-starter --emit-request <new-file>",
    "  pnpm public-starter --emit-sql <new-file>",
    "  pnpm public-starter --emit-read-sql <new-file>",
    "  pnpm public-starter --bind-response <response-json> --emit-manifest <new-file>",
    "",
    "The default is validation only. This tool never connects to an API or database.",
  ].join("\n");
}

export function runPublicStarterCli(args: string[]) {
  const fixture = loadPublicStarterFixture();
  if (args.length === 0) {
    return `Validated ${fixture.items.length} accepted public starter articles; no external action taken.`;
  }
  if (args.length === 1 && args[0] === "--help") return usage();
  if (args.length === 2 && args[0] === "--emit-request") {
    const path = writeNewFile(
      args[1]!,
      `${JSON.stringify(toPublicationRequest(fixture), null, 2)}\n`,
    );
    return `Wrote a validated, sanitized publication request to ${path}; no external action taken.`;
  }
  if (args.length === 2 && args[0] === "--emit-sql") {
    const path = writeNewFile(args[1]!, buildPublicationSql(fixture));
    return `Wrote reviewed publication SQL to ${path}; no external action taken.`;
  }
  if (args.length === 2 && args[0] === "--emit-read-sql") {
    const path = writeNewFile(args[1]!, buildPublicationReadSql(fixture));
    return `Wrote the sanitized post-publication read SQL to ${path}; no external action taken.`;
  }
  if (
    args.length === 4 &&
    args[0] === "--bind-response" &&
    args[2] === "--emit-manifest"
  ) {
    const response = JSON.parse(readFileSync(resolve(args[1]!), "utf8")) as unknown;
    const manifest = bindPublishedSubjectManifest(fixture, response);
    const path = writeNewFile(
      args[3]!,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return `Bound database-generated public IDs in ${path}; no external action taken.`;
  }
  throw new Error(usage());
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    console.log(runPublicStarterCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Public starter validation failed.");
    process.exitCode = 1;
  }
}

export type { PublicStarterEdition };
