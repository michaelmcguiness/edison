import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildArticleGenerationInput } from "@edison/ai";
import { feedResponseSchema } from "@edison/contracts";
import {
  MAX_DAILY_SLOT_ATTEMPTS,
  dailyEditionAttemptIdempotencyKey,
  planDailySlotAttempt,
} from "./daily-editions";
import {
  ARTICLE_GENERATION_PROVIDER_TIMEOUT_MS,
  articleGenerationProviderIdempotencyKey,
  generationRequestSnapshotMatchesDirection,
  newsDirectionSnapshotIsCurrent,
  newsFeedRank,
  selectActiveNewsEditorialDirections,
} from "../../workflows/generate-article";
import {
  newsEditionDateIsInFutureUtc,
  planNewsEditionTransition,
} from "./news-editions";

const editionId = "10000000-0000-4000-8000-000000000001";
const nextEditionId = "10000000-0000-4000-8000-000000000002";

test("News direction selects every persistent and current-edition instruction", () => {
  const selected = selectActiveNewsEditorialDirections(
    [
      {
        id: "persistent-newer",
        scope: "persistent",
        editionId: null,
        text: "Prefer primary-source economic history.",
        revision: 4,
      },
      {
        id: "old-edition",
        scope: "edition",
        editionId: nextEditionId,
        text: "This belongs to another edition.",
        revision: 2,
      },
      {
        id: "current-edition",
        scope: "edition",
        editionId,
        text: "Include one useful climate-policy story today.",
        revision: 3,
      },
      {
        id: "persistent-older",
        scope: "persistent",
        editionId: null,
        text: "Avoid celebrity coverage.",
        revision: 1,
      },
    ],
    editionId,
  );

  assert.deepEqual(selected, [
    { scope: "persistent", text: "Avoid celebrity coverage." },
    {
      scope: "edition",
      text: "Include one useful climate-policy story today.",
    },
    {
      scope: "persistent",
      text: "Prefer primary-source economic history.",
    },
  ]);
});

test("article generation passes scoped directions as reader preferences", () => {
  const editorialDirections = [
    { scope: "persistent" as const, text: "More economic history." },
    { scope: "edition" as const, text: "Cover grid reliability today." },
  ];
  const input = buildArticleGenerationInput(
    {
      userId: editionId,
      editorialDirections,
      goals: [],
      interests: [],
      mutedInterests: [],
      knowledgeState: [],
      recentTitles: [],
      preferredLength: "standard",
      depth: 60,
      novelty: 60,
      allowedCategories: ["tech-science"],
    },
    "2026-09-04",
  );

  assert.deepEqual(input.reader.editorialDirections, editorialDirections);
});

test("provider retries reuse one bounded key for one exact generation snapshot", () => {
  const key = articleGenerationProviderIdempotencyKey(
    editionId,
    { editionId, revision: 7 },
  );
  assert.equal(
    key,
    articleGenerationProviderIdempotencyKey(
      editionId,
      { editionId, revision: 7 },
    ),
  );
  assert.notEqual(
    key,
    articleGenerationProviderIdempotencyKey(
      editionId,
      { editionId, revision: 8 },
    ),
  );
  assert.match(
    key,
    /^edison-generation-v1-[0-9a-f-]{36}-[0-9a-f-]{36}-r7$/,
  );
  assert.equal(ARTICLE_GENERATION_PROVIDER_TIMEOUT_MS, 120_000);

  const aiSource = readFileSync(
    new URL("../../../../packages/ai/src/article-generation.ts", import.meta.url),
    "utf8",
  );
  assert.match(aiSource, /"Idempotency-Key": context\.providerIdempotencyKey/);
  assert.match(aiSource, /timeout: context\.providerTimeoutMs/);
  assert.match(aiSource, /maxRetries: context\.providerIdempotencyKey \? 0/);
});

test("mutable reader context cannot replace the durable request at one direction revision", () => {
  const stored = {
    directionRevision: 7,
    directionEditionId: editionId,
    directionEditionDate: "2026-09-04",
  };
  assert.equal(
    generationRequestSnapshotMatchesDirection(stored, {
      revision: 7,
      editionId,
      editionDate: "2026-09-04",
    }),
    true,
  );

  const workflowSource = readFileSync(
    new URL("../../workflows/generate-article.ts", import.meta.url),
    "utf8",
  );
  const storedBranch = workflowSource.indexOf(
    "generationRequestSnapshotMatchesDirection(stored, direction)",
  );
  const storedReturn = workflowSource.indexOf(
    'return { outcome: "ready", snapshot: stored }',
    storedBranch,
  );
  const newSnapshot = workflowSource.indexOf(
    "const snapshot = generationRequestSnapshotSchema.parse",
    storedBranch,
  );
  assert.ok(storedBranch >= 0 && storedReturn > storedBranch);
  assert.ok(newSnapshot > storedReturn);
  assert.match(
    workflowSource,
    /if \(stored\.directionRevision >= direction\.revision\)/,
  );
});

test("scheduled lanes keep deterministic rank while commissioned work appends", () => {
  const researchedAt = new Date("2026-09-04T12:00:00.000Z");
  const lead = newsFeedRank({ slot: 1 }, researchedAt);
  const second = newsFeedRank({ slot: 2 }, researchedAt);
  const commissioned = newsFeedRank(undefined, researchedAt);
  assert.ok(Number(lead) < Number(second));
  assert.ok(Number(second) < Number(commissioned));
  assert.equal(lead, "1");
  assert.equal(commissioned, String(researchedAt.getTime()));
});

test("failed daily slots get one fresh attempt before the edition stays partial", () => {
  const date = "2026-09-04";
  assert.equal(MAX_DAILY_SLOT_ATTEMPTS, 2);
  assert.deepEqual(planDailySlotAttempt(date, 1, []), {
    outcome: "create",
    attempt: 1,
    idempotencyKey: "daily-edition:2026-09-04:slot:1",
  });
  assert.deepEqual(
    planDailySlotAttempt(date, 1, [
      {
        idempotencyKey: dailyEditionAttemptIdempotencyKey(date, 1, 1),
        status: "failed",
      },
    ]),
    {
      outcome: "create",
      attempt: 2,
      idempotencyKey: "daily-edition:2026-09-04:slot:1:attempt:2",
    },
  );
  assert.deepEqual(
    planDailySlotAttempt(date, 1, [
      {
        idempotencyKey: dailyEditionAttemptIdempotencyKey(date, 1, 1),
        status: "failed",
      },
      {
        idempotencyKey: dailyEditionAttemptIdempotencyKey(date, 1, 2),
        status: "failed",
      },
    ]),
    { outcome: "exhausted" },
  );
  assert.deepEqual(
    planDailySlotAttempt(date, 1, [
      {
        idempotencyKey: dailyEditionAttemptIdempotencyKey(date, 1, 1),
        status: "running",
      },
    ]),
    { outcome: "satisfied" },
  );
});

test("post-generation guard rejects a changed revision, identity, or date", () => {
  const snapshot = {
    editionId,
    editionDate: "2026-09-04",
    revision: 7,
  };
  assert.equal(
    newsDirectionSnapshotIsCurrent(snapshot, {
      currentEditionId: editionId,
      currentEditionDate: "2026-09-04",
      revision: 7,
    }),
    true,
  );
  assert.equal(
    newsDirectionSnapshotIsCurrent(snapshot, {
      currentEditionId: editionId,
      currentEditionDate: "2026-09-04",
      revision: 8,
    }),
    false,
  );
  assert.equal(
    newsDirectionSnapshotIsCurrent(snapshot, {
      currentEditionId: nextEditionId,
      currentEditionDate: "2026-09-05",
      revision: 8,
    }),
    false,
  );
});

test("News edition transitions initialize once, rotate forward, and never regress", () => {
  assert.equal(planNewsEditionTransition(null, "2026-09-04"), "initialized");
  assert.equal(
    planNewsEditionTransition("2026-09-04", "2026-09-04"),
    "current",
  );
  assert.equal(
    planNewsEditionTransition("2026-09-04", "2026-09-05"),
    "rotated",
  );
  assert.equal(
    planNewsEditionTransition("2026-09-05", "2026-09-04"),
    "superseded",
  );
  assert.throws(
    () => planNewsEditionTransition("2026-09-04", "September 5"),
    /YYYY-MM-DD/,
  );
});

test("public starter editions cannot publish before their UTC date", () => {
  const lateUtc = new Date("2026-09-04T23:59:59.999Z");
  assert.equal(newsEditionDateIsInFutureUtc("2026-09-04", lateUtc), false);
  assert.equal(newsEditionDateIsInFutureUtc("2026-09-05", lateUtc), true);

  const publicationSource = readFileSync(
    new URL("./public-starter-editions.ts", import.meta.url),
    "utf8",
  );
  assert.match(publicationSource, /newsEditionDateIsInFutureUtc\(input\.editionDate\)/);
  assert.match(publicationSource, /starter_edition_date_in_future/);
});

test("a later UTC placeholder edition cannot regress after negative-offset timezone capture", () => {
  // At 01:00Z it can still be the prior calendar date in America/New_York.
  // Refusing this transition prevents reactivating an older edition identity.
  assert.equal(
    planNewsEditionTransition("2026-09-05", "2026-09-04"),
    "superseded",
  );

  const profileRoute = readFileSync(
    new URL("../../app/v1/me/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(profileRoute, /if \(input\.timezone !== undefined\)/);
  assert.doesNotMatch(
    profileRoute,
    /input\.timezone !== undefined \|\| !profile\.onboardingComplete/,
  );
});

test("rotation locks state, changes identity, and advances revision", () => {
  const lifecycleSource = readFileSync(
    new URL("./news-editions.ts", import.meta.url),
    "utf8",
  );
  const schedulerSource = readFileSync(
    new URL("./daily-editions.ts", import.meta.url),
    "utf8",
  );
  assert.match(lifecycleSource, /\.for\("update"\)/);
  assert.match(lifecycleSource, /currentEditionId: crypto\.randomUUID\(\)/);
  assert.match(
    lifecycleSource,
    /revision: sql`\$\{editorialDirectionStates\.revision\} \+ 1`/,
  );
  assert.ok(
    schedulerSource.indexOf("ensureNewsEditionForDate(") <
      schedulerSource.indexOf(".insert(generationJobs)"),
  );
  assert.match(
    schedulerSource,
    /newsEditionId: lifecycle\.state\.currentEditionId/,
  );
});

test("finite feed contract distinguishes no edition from an empty current edition", () => {
  assert.equal(
    feedResponseSchema.safeParse({
      editionId: null,
      editionDate: null,
      items: [],
      itemCount: 0,
      nextCursor: null,
      activeCategory: "for-you",
      generatedThrough: null,
    }).success,
    true,
  );
  assert.equal(
    feedResponseSchema.safeParse({
      editionId,
      editionDate: "2026-09-04",
      items: [],
      itemCount: 0,
      nextCursor: null,
      activeCategory: "for-you",
      generatedThrough: null,
    }).success,
    true,
  );
  assert.equal(
    feedResponseSchema.safeParse({
      editionId,
      editionDate: null,
      items: [],
      itemCount: 0,
      nextCursor: null,
      activeCategory: "for-you",
      generatedThrough: null,
    }).success,
    false,
  );
});

test("the authenticated feed query is locked to one edition and has no cursor path", () => {
  const source = readFileSync(
    new URL("../../app/v1/feed/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /eq\(feedItems\.editionId, edition\.currentEditionId\)/,
  );
  assert.match(
    source,
    /eq\(feedItems\.editionDate, edition\.currentEditionDate\)/,
  );
  assert.match(source, /finite_edition_has_no_cursor/);
  assert.doesNotMatch(source, /decodeFeedCursor|encodeFeedCursor/);
});

test("readiness requires the News edition lifecycle schema", () => {
  const source = readFileSync(
    new URL("../../app/v1/health/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /attribute\.attname = 'current_edition_date'/);
  assert.match(source, /attribute\.attname = 'edition_id'/);
  assert.match(source, /feed_items_user_edition_category_rank_idx/);
});

test("generation accounts for a stale model result before retrying without publication", () => {
  const source = readFileSync(
    new URL("../../workflows/generate-article.ts", import.meta.url),
    "utf8",
  );
  const guard = source.indexOf("newsDirectionSnapshotIsCurrent(");
  const staleLedger = source.indexOf(
    'operation: "article_generation_discarded_stale_direction"',
  );
  const articleInsert = source.indexOf("transaction.insert(articles)");
  assert.ok(guard >= 0 && staleLedger > guard && articleInsert > staleLedger);
  assert.match(source, /providerResponseId: result\.providerResponseId/);
  assert.match(source, /throw new RetryableError/);
  assert.match(source, /providerTimeoutMs: ARTICLE_GENERATION_PROVIDER_TIMEOUT_MS/);
  assert.match(source, /rank: newsFeedRank\(edition, researchedAt\)/);
});

test("observed invalid model output is ledgered and terminal", () => {
  const workflowSource = readFileSync(
    new URL("../../workflows/generate-article.ts", import.meta.url),
    "utf8",
  );
  const aiSource = readFileSync(
    new URL("../../../../packages/ai/src/article-generation.ts", import.meta.url),
    "utf8",
  );
  assert.match(aiSource, /new ProviderResponseValidationError/);
  assert.match(aiSource, /client\.responses\.create\(/);
  assert.doesNotMatch(aiSource, /client\.responses\.parse\(/);
  assert.ok(
    aiSource.indexOf("providerResponseUsage(response)") <
      aiSource.indexOf("JSON.parse(response.output_text)"),
  );
  assert.match(
    workflowSource,
    /"article_generation_rejected_provider_response"/,
  );
  assert.match(
    workflowSource,
    /error instanceof ProviderResponseValidationError/,
  );
  assert.match(
    workflowSource,
    /throw new FatalError\("The model response was not safe to publish"\)/,
  );
  assert.match(
    workflowSource,
    /operation: "article_generation_unpriced_provider_response"/,
  );
  assert.match(workflowSource, /provider_model_unpriced/);
  assert.match(workflowSource, /pricingStatus: "unpriced"/);
  assert.match(workflowSource, /costMicrousd: null/);
  assert.match(
    workflowSource,
    /throw new FatalError\("OpenAI returned an unpriced model identity"\)/,
  );
});
