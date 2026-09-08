import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  articleAnswerSchema,
  generatedArticleFormatSchema,
  generatedArticleSchema,
  parsedPreferenceCommandSchema,
} from "../packages/ai/src/schemas";

type JsonSchemaRecord = Record<string, unknown>;

const requireFromAiPackage = createRequire(
  new URL("../packages/ai/package.json", import.meta.url),
);
const { zodTextFormat } = requireFromAiPackage("openai/helpers/zod") as {
  zodTextFormat: (
    schema: unknown,
    name: string,
  ) => { schema: JsonSchemaRecord };
};

function isRecord(value: unknown): value is JsonSchemaRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectKeywordValues(value: unknown, keyword: string): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectKeywordValues(item, keyword));
  }
  if (!isRecord(value)) return [];

  const matches = Object.hasOwn(value, keyword) ? [value[keyword]] : [];
  return matches.concat(
    Object.values(value).flatMap((item) =>
      collectKeywordValues(item, keyword),
    ),
  );
}

function collectPropertySchemas(
  value: unknown,
  propertyName: string,
): JsonSchemaRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      collectPropertySchemas(item, propertyName),
    );
  }
  if (!isRecord(value)) return [];

  const properties = value.properties;
  const ownMatch =
    isRecord(properties) && isRecord(properties[propertyName])
      ? [properties[propertyName]]
      : [];

  return ownMatch.concat(
    Object.values(value).flatMap((item) =>
      collectPropertySchemas(item, propertyName),
    ),
  );
}

const articleFormat = zodTextFormat(
  generatedArticleFormatSchema,
  "edison_article",
);

test("provider article schema expresses source URLs without unsupported uri format", () => {
  const urlSchemas = collectPropertySchemas(articleFormat.schema, "url");

  assert.ok(urlSchemas.length > 0);
  for (const urlSchema of urlSchemas) {
    assert.equal(urlSchema.type, "string");
    assert.equal(urlSchema.format, undefined);
    assert.equal(urlSchema.pattern, /^https?:\/\//.source);
    assert.equal(urlSchema.maxLength, 2_048);
  }
});

test("all provider text formats use OpenAI-supported string formats", () => {
  const supportedStringFormats = new Set([
    "date-time",
    "time",
    "date",
    "duration",
    "email",
    "hostname",
    "ipv4",
    "ipv6",
    "uuid",
  ]);
  const schemas = [
    articleFormat.schema,
    zodTextFormat(articleAnswerSchema, "edison_article_answer").schema,
    zodTextFormat(
      parsedPreferenceCommandSchema,
      "edison_preference_changes",
    ).schema,
  ];
  const formats = schemas.flatMap((schema) =>
    collectKeywordValues(schema, "format"),
  );

  assert.ok(formats.length > 0);
  for (const format of formats) {
    assert.equal(typeof format, "string");
    assert.ok(
      supportedStringFormats.has(format as string),
      `unsupported provider string format: ${String(format)}`,
    );
  }
  assert.deepEqual([...new Set(formats)].sort(), ["date-time"]);
});

const validArticle = {
  category: "tech-science" as const,
  kicker: "Science",
  topic: "A test topic",
  title: "A generated article",
  deck: "A test deck.",
  summary: ["First", "Second", "Third"],
  whyWritten: "It advances a stated learning goal.",
  readingMinutes: 6,
  body: Array.from({ length: 6 }, (_, index) => ({
    type: "paragraph" as const,
    text: `Grounded paragraph ${index + 1}.`,
    citations: [{ sourceKey: "source-1", label: String(index + 1) }],
  })),
  sources: [
    {
      key: "source-1",
      title: "Source one",
      publisher: "Example Institute",
      url: "https://example.com/one",
      publishedAt: null,
    },
    {
      key: "source-2",
      title: "Source two",
      publisher: "Example Institute",
      url: "https://example.com/two",
      publishedAt: null,
    },
  ],
};

test("publication validation retains canonical URL and citation checks", () => {
  assert.equal(generatedArticleSchema.safeParse(validArticle).success, true);

  for (const url of [
    "not a URL",
    "ftp://example.com/source",
    "https://reader:secret@example.com/source",
    `https://example.com/${"x".repeat(2_100)}`,
  ]) {
    const result = generatedArticleSchema.safeParse({
      ...validArticle,
      sources: [{ ...validArticle.sources[0], url }, validArticle.sources[1]],
    });

    assert.equal(result.success, false, `expected ${url} to be rejected`);
    assert.ok(
      result.error.issues.some(
        (issue) => issue.path.join(".") === "sources.0.url",
      ),
    );
  }

  const unknownCitation = generatedArticleSchema.safeParse({
    ...validArticle,
    body: validArticle.body.map((block, index) =>
      index === 0
        ? {
            ...block,
            citations: [{ sourceKey: "missing-source", label: "1" }],
          }
        : block,
    ),
  });

  assert.equal(unknownCitation.success, false);
  assert.ok(
    unknownCitation.error.issues.some(
      (issue) => issue.path.join(".") === "body.0.citations.0.sourceKey",
    ),
  );
});
