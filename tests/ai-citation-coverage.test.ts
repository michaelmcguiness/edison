import assert from "node:assert/strict";
import test from "node:test";

import { assertCitationsAreGrounded } from "../packages/ai/src/article-generation";
import {
  generatedArticleSchema,
  type GeneratedArticle,
} from "../packages/ai/src/schemas";

const sources = [
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
];

const citedParagraph = (index: number, sourceKey = "source-1") => ({
  type: "paragraph" as const,
  text: `Grounded paragraph ${index}.`,
  citations: [{ sourceKey, label: String(index) }],
});

const baseArticle = {
  category: "tech-science" as const,
  kicker: "Science",
  topic: "A test topic",
  title: "A generated article",
  deck: "A test deck.",
  summary: ["First", "Second", "Third"],
  whyWritten: "It advances a stated learning goal.",
  readingMinutes: 6,
  body: [
    { type: "heading" as const, level: 2 as const, text: "The opening" },
    citedParagraph(1),
    citedParagraph(2, "source-2"),
    {
      type: "quote" as const,
      text: "A short, sourced quotation.",
      attribution: "Example speaker",
      citations: [{ sourceKey: "source-2", label: "3" }],
    },
    { type: "heading" as const, level: 2 as const, text: "The conclusion" },
    citedParagraph(4),
  ],
  sources,
};

function citationIssuePaths(input: unknown) {
  const result = generatedArticleSchema.safeParse(input);
  assert.equal(result.success, false);
  return result.error.issues.map((issue) => issue.path.join("."));
}

test("generated article citation coverage accepts fully cited prose and uncited headings", () => {
  const article = generatedArticleSchema.parse(baseArticle);

  assert.doesNotThrow(() =>
    assertCitationsAreGrounded(
      article,
      new Set(sources.map((source) => source.url)),
    ),
  );
});

test("generated article citation coverage rejects an all-uncited body", () => {
  const allUncited = {
    ...baseArticle,
    body: Array.from({ length: 6 }, (_, index) => ({
      type: index === 3 ? ("quote" as const) : ("paragraph" as const),
      text: `Unsupported prose ${index + 1}.`,
      ...(index === 3 ? { attribution: "Example speaker" } : {}),
      citations: [],
    })),
  };

  assert.deepEqual(citationIssuePaths(allUncited), [
    "body.0.citations",
    "body.1.citations",
    "body.2.citations",
    "body.3.citations",
    "body.4.citations",
    "body.5.citations",
  ]);
});

test("generated article citation coverage rejects one uncited block in mixed prose", () => {
  const mixedCoverage = {
    ...baseArticle,
    body: baseArticle.body.map((block, index) =>
      index === 2 && block.type === "paragraph"
        ? { ...block, citations: [] }
        : block,
    ),
  };

  assert.deepEqual(citationIssuePaths(mixedCoverage), ["body.2.citations"]);
});

test("generated article citation coverage rejects citations to omitted sources", () => {
  const unknownSource = {
    ...baseArticle,
    body: baseArticle.body.map((block, index) =>
      index === 1 && block.type === "paragraph"
        ? {
            ...block,
            citations: [{ sourceKey: "not-in-sources", label: "1" }],
          }
        : block,
    ),
  };

  assert.deepEqual(citationIssuePaths(unknownSource), [
    "body.1.citations.0.sourceKey",
  ]);
});

test("generated article grounding rejects source URLs absent from web research", () => {
  const article: GeneratedArticle = generatedArticleSchema.parse(baseArticle);

  assert.throws(
    () => assertCitationsAreGrounded(article, new Set([sources[0].url])),
    /cited a URL that was not returned by web search/,
  );
  assert.throws(
    () => assertCitationsAreGrounded(article, new Set()),
    /did not include web research sources/,
  );
});

test("generated article sources enforce the canonical safe URL contract", () => {
  for (const url of [
    "ftp://example.com/source",
    "https://reader:secret@example.com/source",
    `https://example.com/${"x".repeat(2_100)}`,
  ]) {
    const result = generatedArticleSchema.safeParse({
      ...baseArticle,
      sources: [
        { ...sources[0], url },
        sources[1],
      ],
    });

    assert.equal(result.success, false, `expected ${url} to be rejected`);
    assert.ok(
      result.error.issues.some(
        (issue) => issue.path.join(".") === "sources.0.url",
      ),
    );
  }
});
