import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildArticleGenerationInput } from "@edison/ai";
import {
  createLearningLoopRequestSchema,
  learningLoopDirectionRequestSchema,
  learningLoopSchema,
  maxLearningLoops,
  maxLoopPublicArticles,
} from "@edison/contracts";
import {
  articleGenerationProviderIdempotencyKey,
  generationRequestSnapshotMatchesContext,
  learningLoopSnapshotIsCurrent,
} from "../../workflows/generate-article";
import {
  latestReversibleLearningLoopMutationId,
  normalizeLearningLoopDisplayTitle,
  normalizeLearningLoopTitle,
  selectLearningLoopForDailySlot,
} from "./learning-loop-rules";

const loopId = "61000000-0000-4000-8000-000000000001";
const editionId = "62000000-0000-4000-8000-000000000001";
const mutationId = "63000000-0000-4000-8000-000000000001";

test("loop creation preserves short explicit curiosity and rejects ambiguous retries", () => {
  const parsed = createLearningLoopRequestSchema.parse({
    title: "  AI\u00a0systems  ",
    originalCuriosity: "AI",
    publicArticleIds: ["64000000-0000-4000-8000-000000000001"],
    idempotencyKey: "loop-create-1",
  });
  assert.equal(parsed.originalCuriosity, "AI");
  assert.equal(normalizeLearningLoopDisplayTitle(parsed.title), "AI systems");
  assert.equal(normalizeLearningLoopTitle(parsed.title), "ai systems");
  assert.equal(maxLearningLoops, 30);
  assert.equal(maxLoopPublicArticles, 30);

  assert.equal(
    createLearningLoopRequestSchema.safeParse({
      ...parsed,
      publicArticleIds: [
        "64000000-0000-4000-8000-000000000001",
        "64000000-0000-4000-8000-000000000001",
      ],
    }).success,
    false,
  );
  assert.equal(
    createLearningLoopRequestSchema.safeParse({
      ...parsed,
      inferredExpertise: "expert",
    }).success,
    false,
  );
});

test("Curate set and undo requests require CAS and one durable idempotency key", () => {
  assert.deepEqual(
    learningLoopDirectionRequestSchema.parse({
      operation: "set",
      direction: "Follow the labor-market consequences next.",
      baseRevision: 3,
      idempotencyKey: "loop-direction-4",
    }),
    {
      operation: "set",
      direction: "Follow the labor-market consequences next.",
      baseRevision: 3,
      idempotencyKey: "loop-direction-4",
    },
  );
  assert.deepEqual(
    learningLoopDirectionRequestSchema.parse({
      operation: "undo",
      mutationId,
      baseRevision: 4,
      idempotencyKey: "loop-direction-undo-4",
    }).operation,
    "undo",
  );
  assert.equal(
    learningLoopDirectionRequestSchema.safeParse({
      operation: "undo",
      mutationId,
      baseRevision: 4,
      idempotencyKey: "loop-direction-undo-4",
      direction: "Do something else",
    }).success,
    false,
  );
});

test("reload exposes Undo only for the latest unreverted set mutation", () => {
  const setMutation = {
    id: mutationId,
    operation: "set",
    resultingRevision: 1,
    revertedByMutationId: null,
  };
  assert.equal(
    latestReversibleLearningLoopMutationId(1, [setMutation]),
    mutationId,
  );
  assert.equal(
    latestReversibleLearningLoopMutationId(2, [
      {
        id: "63000000-0000-4000-8000-000000000002",
        operation: "undo",
        resultingRevision: 2,
        revertedByMutationId: null,
      },
      { ...setMutation, revertedByMutationId: mutationId },
    ]),
    null,
  );

  const restored = learningLoopSchema.parse({
    id: loopId,
    title: "AI",
    originalCuriosity: "AI",
    direction: "",
    revision: 2,
    paused: false,
    lastMutationId: null,
    directionHistory: [
      {
        id: "63000000-0000-4000-8000-000000000002",
        operation: "undo",
        previousDirection: "Follow the mechanisms.",
        resultingDirection: "",
        previousRevision: 1,
        resultingRevision: 2,
        undoneMutationId: mutationId,
        stillReversible: false,
        createdAt: "2026-09-05T20:00:00.000Z",
      },
    ],
    articleIds: [],
    publicArticleIds: [],
    createdAt: "2026-09-05T19:00:00.000Z",
    updatedAt: "2026-09-05T20:00:00.000Z",
  });
  assert.equal(restored.direction, "");
  assert.equal(restored.lastMutationId, null);
});

test("daily loop rotation is deterministic and changes across days", () => {
  const loops = [{ id: "one" }, { id: "two" }, { id: "three" }];
  const first = selectLearningLoopForDailySlot(loops, "2026-09-05", 1);
  assert.deepEqual(
    first,
    selectLearningLoopForDailySlot(loops, "2026-09-05", 1),
  );
  assert.notEqual(
    first?.id,
    selectLearningLoopForDailySlot(loops, "2026-09-06", 1)?.id,
  );
  assert.notEqual(
    first?.id,
    selectLearningLoopForDailySlot(loops, "2026-09-05", 2)?.id,
  );
  assert.equal(selectLearningLoopForDailySlot([], "2026-09-05", 1), undefined);
});

test("provider identity and stale guards include exact loop direction revision", () => {
  const news = {
    editionId,
    editionDate: "2026-09-05",
    revision: 7,
  };
  const loop = { id: loopId, revision: 4, direction: "Go deeper." };
  const snapshot = {
    directionEditionId: editionId,
    directionEditionDate: "2026-09-05",
    directionRevision: 7,
    learningLoop: loop,
  };
  assert.equal(generationRequestSnapshotMatchesContext(snapshot, news, loop), true);
  assert.equal(
    generationRequestSnapshotMatchesContext(snapshot, news, {
      ...loop,
      revision: 5,
    }),
    false,
  );
  assert.equal(
    learningLoopSnapshotIsCurrent(loop, { ...loop, status: "active" }),
    true,
  );
  assert.equal(
    learningLoopSnapshotIsCurrent(loop, { ...loop, status: "paused" }),
    false,
  );
  assert.notEqual(
    articleGenerationProviderIdempotencyKey(loopId, news, loop),
    articleGenerationProviderIdempotencyKey(loopId, news, {
      ...loop,
      revision: 5,
    }),
  );
});

test("generation input carries bounded loop continuity without claiming mastery", () => {
  const input = buildArticleGenerationInput({
    userId: loopId,
    requestedTopic: "AI",
    goals: [],
    interests: [],
    mutedInterests: [],
    knowledgeState: [],
    recentTitles: [],
    preferredLength: "standard",
    depth: 60,
    novelty: 60,
    allowedCategories: ["tech-science"],
    editorialDirections: [{ scope: "loop", text: "Go deeper." }],
    learningLoop: {
      title: "AI",
      originalCuriosity: "AI",
      previousArticles: [
        {
          topic: "Transformers",
          title: "What attention buys",
          summary: ["One", "Two", "Three"],
        },
      ],
    },
  });
  assert.equal(input.reader.editorialDirections[0]?.scope, "loop");
  assert.equal(input.reader.learningLoop?.previousArticles.length, 1);

  const aiSource = readFileSync(
    new URL("../../../../packages/ai/src/article-generation.ts", import.meta.url),
    "utf8",
  );
  assert.match(aiSource, /not evidence that the\s*\nreader has read, retained, mastered/);
});

test("loop services preserve isolation, replay, exact undo, and explicit membership", () => {
  const source = readFileSync(new URL("./learning-loops.ts", import.meta.url), "utf8");
  const insertMutation = source.indexOf(
    ".insert(learningLoopDirectionMutations)",
  );
  const updateLoop = source.indexOf(".update(learningThreads)", insertMutation);
  assert.match(source, /eq\(learningThreads\.userId, userId\)/);
  assert.match(source, /inArray\(learningThreads\.status, \["active", "paused"\]\)/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /assertCreationFingerprint/);
  assert.match(source, /eq\(learningThreads\.revision, loop\.revision\)/);
  assert.match(source, /afterDirection = sourceMutation\.beforeDirection/);
  assert.ok(insertMutation >= 0 && updateLoop > insertMutation);
  assert.match(source, /validatePublicArticles\(transaction, input\.publicArticleIds\)/);
  assert.doesNotMatch(source, /inferredExpertise|political/);
});

test("loop routes use normal auth, bounded JSON, UUIDs, and owned services", () => {
  const routes = [
    "../../app/v1/loops/route.ts",
    "../../app/v1/loops/[loopId]/direction/route.ts",
    "../../app/v1/loops/[loopId]/articles/route.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  for (const source of routes) assert.match(source, /apiHandler\(request/);
  assert.match(routes[0]!, /readJsonBody\(request, MAX_CREATE_LOOP_BODY_BYTES\)/);
  assert.match(routes[1]!, /uuidSchema\.parse\(rawLoopId\)/);
  assert.match(routes[1]!, /readJsonBody\(request, MAX_DIRECTION_BODY_BYTES\)/);
  assert.match(routes[2]!, /learningLoopArticlesQuerySchema\.parse/);
});

test("scheduler and publisher consume active loops without changing quota caps", () => {
  const scheduler = readFileSync(new URL("./daily-editions.ts", import.meta.url), "utf8");
  const workflow = readFileSync(
    new URL("../../workflows/generate-article.ts", import.meta.url),
    "utf8",
  );
  assert.match(scheduler, /eq\(learningThreads\.status, "active"\)/);
  assert.match(scheduler, /selectLearningLoopForDailySlot/);
  assert.match(scheduler, /learningLoopId:/);
  assert.match(scheduler, /"learning-thread" as const/);
  assert.match(workflow, /learningLoopRequestSnapshotSchema\.nullable\(\)/);
  assert.match(workflow, /\.for\("share"\)/);
  assert.match(workflow, /article_generation_discarded_stale_loop_direction/);
  assert.match(workflow, /learningThreadId: learningLoop\?\.id \?\? null/);
  assert.match(workflow, /\.limit\(3\)/);
  assert.match(workflow, /eq\(articles\.learningThreadId, learningLoop\.id\)/);
  assert.match(workflow, /\.from\(learningLoopPublicArticles\)/);
  assert.match(workflow, /sharedArticleSnapshotSchema\.parse\(row\.snapshot\)/);
  assert.match(scheduler, /OPENAI_MAX_DAILY_GENERATIONS/);
});

test("readiness requires the complete learning-loop database boundary", () => {
  const source = readFileSync(
    new URL("../../app/v1/health/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /public\.learning_loop_direction_mutations/);
  assert.match(source, /public\.learning_loop_public_articles/);
  assert.match(source, /'original_curiosity'/);
  assert.match(source, /learning_threads_enforce_retained_limit/);
  assert.match(source, /learning_loop_direction_mutations_validate/);
  assert.match(source, /articles_learning_loop_owner_fk/);
  assert.match(source, /private\.read_article_correction_disclosure\(uuid\)/);
});
