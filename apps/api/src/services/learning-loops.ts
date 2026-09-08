import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import {
  articleCategorySchema,
  learningLoopArticlesResponseSchema,
  learningLoopMutationResponseSchema,
  learningLoopResponseSchema,
  learningLoopSchema,
  learningLoopsResponseSchema,
  maxLearningLoops,
  maxLoopArticleCards,
  maxLoopDirectionHistory,
  sharedArticleSnapshotSchema,
  type CreateLearningLoopRequest,
  type LearningLoop,
  type LearningLoopArticleCard,
  type LearningLoopDirectionRequest,
  type LearningLoopMutationResponse,
} from "@edison/contracts";
import {
  articles,
  learningLoopDirectionMutations,
  learningLoopPublicArticles,
  learningThreads,
  publicStarterEditionArticles,
  publicStarterEditions,
  readingEvents,
  savedArticles,
  type UserTransaction,
  type VerifiedUserClaims,
} from "@edison/db";
import { HttpError } from "../http/errors";
import {
  latestReversibleLearningLoopMutationId,
  normalizeLearningLoopDisplayTitle,
  normalizeLearningLoopTitle,
} from "./learning-loop-rules";
import { withActiveMember } from "./members";
import { fingerprintRequest } from "./request-fingerprint";

type LoopRow = typeof learningThreads.$inferSelect;
type LoopMutationRow = typeof learningLoopDirectionMutations.$inferSelect;

function loopSlug(normalizedTitle: string, loopId: string) {
  const base = normalizedTitle
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${base || "loop"}-${loopId.slice(0, 8)}`;
}

async function requireOwnedLoop(
  transaction: UserTransaction,
  userId: string,
  loopId: string,
  lock = false,
) {
  const query = transaction
    .select()
    .from(learningThreads)
    .where(
      and(
        eq(learningThreads.id, loopId),
        eq(learningThreads.userId, userId),
        inArray(learningThreads.status, ["active", "paused"]),
      ),
    )
    .limit(1);
  const rows = lock ? await query.for("update") : await query;
  const loop = rows[0];
  if (!loop) {
    throw new HttpError(
      404,
      "learning_loop_not_found",
      "That learning loop was not found.",
    );
  }
  return loop;
}

async function presentLearningLoop(
  transaction: UserTransaction,
  loop: LoopRow,
): Promise<LearningLoop> {
  const [history, privateArticles, publicArticles] = await Promise.all([
    transaction
      .select()
      .from(learningLoopDirectionMutations)
      .where(
        and(
          eq(learningLoopDirectionMutations.loopId, loop.id),
          eq(learningLoopDirectionMutations.userId, loop.userId),
        ),
      )
      .orderBy(
        desc(learningLoopDirectionMutations.resultingRevision),
        desc(learningLoopDirectionMutations.id),
      )
      .limit(maxLoopDirectionHistory),
    transaction
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          eq(articles.ownerId, loop.userId),
          eq(articles.learningThreadId, loop.id),
          eq(articles.status, "published"),
        ),
      )
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(maxLoopArticleCards),
    transaction
      .select({ publicArticleId: learningLoopPublicArticles.publicArticleId })
      .from(learningLoopPublicArticles)
      .where(
        and(
          eq(learningLoopPublicArticles.loopId, loop.id),
          eq(learningLoopPublicArticles.userId, loop.userId),
        ),
      )
      .orderBy(asc(learningLoopPublicArticles.position)),
  ]);

  return learningLoopSchema.parse({
    id: loop.id,
    title: loop.title,
    originalCuriosity: loop.originalCuriosity,
    direction: loop.direction,
    revision: loop.revision,
    paused: loop.status === "paused",
    lastMutationId: latestReversibleLearningLoopMutationId(
      loop.revision,
      history,
    ),
    directionHistory: history.map((mutation) => ({
      id: mutation.id,
      operation: mutation.operation,
      previousDirection: mutation.beforeDirection,
      resultingDirection: mutation.afterDirection,
      previousRevision: mutation.baseRevision,
      resultingRevision: mutation.resultingRevision,
      undoneMutationId: mutation.undoOfMutationId,
      stillReversible:
        mutation.operation === "set" &&
        mutation.revertedByMutationId === null &&
        mutation.resultingRevision === loop.revision,
      createdAt: mutation.createdAt.toISOString(),
    })),
    articleIds: privateArticles.map((article) => article.id),
    publicArticleIds: publicArticles.map((article) => article.publicArticleId),
    createdAt: loop.createdAt.toISOString(),
    updatedAt: loop.updatedAt.toISOString(),
  });
}

async function findLoopByCreationKey(
  transaction: UserTransaction,
  userId: string,
  idempotencyKey: string,
) {
  const [loop] = await transaction
    .select()
    .from(learningThreads)
    .where(
      and(
        eq(learningThreads.userId, userId),
        eq(learningThreads.creationIdempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return loop;
}

async function findLoopByNormalizedTitle(
  transaction: UserTransaction,
  userId: string,
  normalizedTitle: string,
) {
  const [loop] = await transaction
    .select()
    .from(learningThreads)
    .where(
      and(
        eq(learningThreads.userId, userId),
        eq(learningThreads.normalizedTitle, normalizedTitle),
      ),
    )
    .limit(1);
  return loop;
}

function assertCreationFingerprint(loop: LoopRow, fingerprint: string) {
  if (loop.creationRequestFingerprint !== fingerprint) {
    throw new HttpError(
      409,
      "idempotency_key_reused",
      "That idempotency key was already used for a different learning loop.",
    );
  }
}

async function replayCreatedLoop(
  transaction: UserTransaction,
  loop: LoopRow,
  fingerprint: string,
) {
  assertCreationFingerprint(loop, fingerprint);
  if (loop.status === "archived") {
    throw new HttpError(
      409,
      "learning_loop_archived",
      "That learning loop is archived and cannot be reused.",
    );
  }
  return learningLoopResponseSchema.parse({
    loop: await presentLearningLoop(transaction, loop),
    replayed: true,
  });
}

async function validatePublicArticles(
  transaction: UserTransaction,
  publicArticleIds: string[],
) {
  if (!publicArticleIds.length) return;
  const rows = await transaction
    .select({ id: publicStarterEditionArticles.id })
    .from(publicStarterEditionArticles)
    .innerJoin(
      publicStarterEditions,
      eq(publicStarterEditions.id, publicStarterEditionArticles.editionId),
    )
    .where(
      and(
        inArray(publicStarterEditionArticles.id, publicArticleIds),
        eq(publicStarterEditions.status, "published"),
        lte(publicStarterEditions.publishedAt, new Date()),
      ),
    );
  if (new Set(rows.map((row) => row.id)).size !== publicArticleIds.length) {
    throw new HttpError(
      409,
      "learning_loop_public_article_unavailable",
      "One or more selected public articles are not currently available.",
    );
  }
}

export async function listLearningLoops(claims: VerifiedUserClaims) {
  return withActiveMember(claims, async ({ transaction }) => {
    const rows = await transaction
      .select()
      .from(learningThreads)
      .where(
        and(
          eq(learningThreads.userId, claims.sub),
          inArray(learningThreads.status, ["active", "paused"]),
        ),
      )
      .orderBy(asc(learningThreads.createdAt), asc(learningThreads.id))
      .limit(maxLearningLoops + 1);
    if (rows.length > maxLearningLoops) {
      throw new HttpError(
        500,
        "learning_loop_limit_invalid",
        "The reader has more learning loops than the API can safely return.",
      );
    }

    const loops: LearningLoop[] = [];
    for (const row of rows) {
      loops.push(await presentLearningLoop(transaction, row));
    }
    return learningLoopsResponseSchema.parse({ loops });
  });
}

export async function createLearningLoop(
  claims: VerifiedUserClaims,
  input: CreateLearningLoopRequest,
) {
  const title = normalizeLearningLoopDisplayTitle(input.title);
  const normalizedTitle = normalizeLearningLoopTitle(input.title);
  const fingerprint = fingerprintRequest([
    "create-learning-loop",
    normalizedTitle,
    input.originalCuriosity,
    input.publicArticleIds,
  ]);

  return withActiveMember(claims, async ({ transaction }) => {
    const existingByKey = await findLoopByCreationKey(
      transaction,
      claims.sub,
      input.idempotencyKey,
    );
    if (existingByKey) {
      return replayCreatedLoop(transaction, existingByKey, fingerprint);
    }

    await transaction.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`edison-learning-loops:${claims.sub}`}, 0)
      )
    `);

    const replayAfterLock = await findLoopByCreationKey(
      transaction,
      claims.sub,
      input.idempotencyKey,
    );
    if (replayAfterLock) {
      return replayCreatedLoop(transaction, replayAfterLock, fingerprint);
    }

    const existingByTitle = await findLoopByNormalizedTitle(
      transaction,
      claims.sub,
      normalizedTitle,
    );
    if (existingByTitle) {
      if (existingByTitle.creationRequestFingerprint !== fingerprint) {
        throw new HttpError(
          409,
          "learning_loop_title_exists",
          "A learning loop with that title already exists.",
        );
      }
      return replayCreatedLoop(transaction, existingByTitle, fingerprint);
    }

    const [{ value: retainedLoopCount }] = await transaction
      .select({ value: count() })
      .from(learningThreads)
      .where(
        and(
          eq(learningThreads.userId, claims.sub),
          inArray(learningThreads.status, ["active", "paused"]),
        ),
      );
    if (retainedLoopCount >= maxLearningLoops) {
      throw new HttpError(
        409,
        "learning_loop_limit_reached",
        `You can keep up to ${maxLearningLoops} learning loops.`,
      );
    }

    await validatePublicArticles(transaction, input.publicArticleIds);

    const loopId = crypto.randomUUID();
    const [created] = await transaction
      .insert(learningThreads)
      .values({
        id: loopId,
        userId: claims.sub,
        title,
        normalizedTitle,
        originalCuriosity: input.originalCuriosity,
        direction: "",
        revision: 0,
        creationIdempotencyKey: input.idempotencyKey,
        creationRequestFingerprint: fingerprint,
        slug: loopSlug(normalizedTitle, loopId),
        summary: input.originalCuriosity,
        status: "active",
        currentLevel: "unspecified",
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw new HttpError(
        409,
        "learning_loop_creation_conflict",
        "A concurrent request created that learning loop first.",
      );
    }

    if (input.publicArticleIds.length) {
      await transaction.insert(learningLoopPublicArticles).values(
        input.publicArticleIds.map((publicArticleId, index) => ({
          loopId,
          userId: claims.sub,
          publicArticleId,
          position: index + 1,
        })),
      );
    }

    return learningLoopResponseSchema.parse({
      loop: await presentLearningLoop(transaction, created),
      replayed: false,
    });
  });
}

function directionFingerprint(
  loopId: string,
  input: LearningLoopDirectionRequest,
) {
  return input.operation === "set"
    ? fingerprintRequest([
        "set-learning-loop-direction",
        loopId,
        input.direction,
        input.baseRevision,
      ])
    : fingerprintRequest([
        "undo-learning-loop-direction",
        loopId,
        input.mutationId,
        input.baseRevision,
      ]);
}

function assertMutationFingerprint(
  mutation: LoopMutationRow,
  loopId: string,
  fingerprint: string,
) {
  if (
    mutation.loopId !== loopId ||
    mutation.requestFingerprint !== fingerprint
  ) {
    throw new HttpError(
      409,
      "idempotency_key_reused",
      "That idempotency key was already used for a different loop direction edit.",
    );
  }
}

async function presentMutation(
  transaction: UserTransaction,
  loop: LoopRow,
  mutation: LoopMutationRow,
  replayed: boolean,
): Promise<LearningLoopMutationResponse> {
  const stillReversible =
    mutation.operation === "set" &&
    mutation.revertedByMutationId === null &&
    mutation.resultingRevision === loop.revision;
  return learningLoopMutationResponseSchema.parse({
    loop: await presentLearningLoop(transaction, loop),
    mutationId: mutation.id,
    operation: mutation.operation,
    previousRevision: mutation.baseRevision,
    resultingRevision: mutation.resultingRevision,
    replayed,
    stillReversible,
    undoneMutationId: mutation.undoOfMutationId,
  });
}

async function replayDirectionMutation(
  transaction: UserTransaction,
  userId: string,
  loopId: string,
  idempotencyKey: string,
  fingerprint: string,
) {
  const [mutation] = await transaction
    .select()
    .from(learningLoopDirectionMutations)
    .where(
      and(
        eq(learningLoopDirectionMutations.userId, userId),
        eq(learningLoopDirectionMutations.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!mutation) return null;
  assertMutationFingerprint(mutation, loopId, fingerprint);
  const loop = await requireOwnedLoop(transaction, userId, loopId);
  return presentMutation(transaction, loop, mutation, true);
}

export async function mutateLearningLoopDirection(
  claims: VerifiedUserClaims,
  loopId: string,
  input: LearningLoopDirectionRequest,
) {
  const fingerprint = directionFingerprint(loopId, input);
  return withActiveMember(claims, async ({ transaction }) => {
    await transaction.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(
          ${`edison-learning-loop-direction:${claims.sub}:${input.idempotencyKey}`},
          0
        )
      )
    `);
    const replay = await replayDirectionMutation(
      transaction,
      claims.sub,
      loopId,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay) return replay;

    const loop = await requireOwnedLoop(transaction, claims.sub, loopId, true);
    const replayAfterLock = await replayDirectionMutation(
      transaction,
      claims.sub,
      loopId,
      input.idempotencyKey,
      fingerprint,
    );
    if (replayAfterLock) return replayAfterLock;
    if (loop.revision !== input.baseRevision) {
      throw new HttpError(
        409,
        "learning_loop_revision_conflict",
        "The loop direction changed before this edit was saved.",
        {
          expectedRevision: input.baseRevision,
          currentRevision: loop.revision,
        },
      );
    }

    let afterDirection: string;
    let sourceMutation: LoopMutationRow | undefined;
    if (input.operation === "set") {
      afterDirection = input.direction;
    } else {
      [sourceMutation] = await transaction
        .select()
        .from(learningLoopDirectionMutations)
        .where(
          and(
            eq(learningLoopDirectionMutations.id, input.mutationId),
            eq(learningLoopDirectionMutations.loopId, loop.id),
            eq(learningLoopDirectionMutations.userId, claims.sub),
          ),
        )
        .limit(1);
      if (!sourceMutation || sourceMutation.operation !== "set") {
        throw new HttpError(
          404,
          "learning_loop_mutation_not_found",
          "That loop direction change was not found.",
        );
      }
      if (sourceMutation.revertedByMutationId) {
        throw new HttpError(
          409,
          "learning_loop_mutation_already_undone",
          "That loop direction change has already been undone.",
        );
      }
      if (
        sourceMutation.resultingRevision !== loop.revision ||
        sourceMutation.afterDirection !== loop.direction
      ) {
        throw new HttpError(
          409,
          "learning_loop_undo_conflict",
          "The loop direction has changed since that edit.",
        );
      }
      afterDirection = sourceMutation.beforeDirection;
    }

    const mutationId = crypto.randomUUID();
    const nextRevision = loop.revision + 1;
    const [mutation] = await transaction
      .insert(learningLoopDirectionMutations)
      .values({
        id: mutationId,
        loopId: loop.id,
        userId: claims.sub,
        operation: input.operation,
        baseRevision: loop.revision,
        resultingRevision: nextRevision,
        beforeDirection: loop.direction,
        afterDirection,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        undoOfMutationId: sourceMutation?.id ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!mutation) {
      throw new HttpError(
        409,
        "learning_loop_mutation_conflict",
        "A concurrent loop direction edit was saved first.",
      );
    }

    if (sourceMutation) {
      const [reverted] = await transaction
        .update(learningLoopDirectionMutations)
        .set({ revertedByMutationId: mutation.id, updatedAt: new Date() })
        .where(
          and(
            eq(learningLoopDirectionMutations.id, sourceMutation.id),
            eq(learningLoopDirectionMutations.userId, claims.sub),
            eq(learningLoopDirectionMutations.loopId, loop.id),
            isNull(learningLoopDirectionMutations.revertedByMutationId),
          ),
        )
        .returning({ id: learningLoopDirectionMutations.id });
      if (!reverted) {
        throw new HttpError(
          409,
          "learning_loop_undo_conflict",
          "That loop direction change was already undone.",
        );
      }
    }

    const [updatedLoop] = await transaction
      .update(learningThreads)
      .set({
        direction: afterDirection,
        revision: nextRevision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(learningThreads.id, loop.id),
          eq(learningThreads.userId, claims.sub),
          eq(learningThreads.revision, loop.revision),
          inArray(learningThreads.status, ["active", "paused"]),
        ),
      )
      .returning();
    if (!updatedLoop) {
      throw new HttpError(
        409,
        "learning_loop_revision_conflict",
        "The loop direction changed before this edit was saved.",
      );
    }

    return presentMutation(transaction, updatedLoop, mutation, false);
  });
}

export async function listLearningLoopArticles(
  claims: VerifiedUserClaims,
  loopId: string,
  limit: number,
) {
  return withActiveMember(claims, async ({ transaction }) => {
    await requireOwnedLoop(transaction, claims.sub, loopId);

    const [privateRows, publicRows] = await Promise.all([
      transaction
        .select({
          id: articles.id,
          slug: articles.slug,
          category: articles.category,
          kicker: articles.kicker,
          title: articles.title,
          deck: articles.deck,
          readingMinutes: articles.readingMinutes,
          sourceCount: articles.sourceCount,
          researchedAt: articles.researchedAt,
          reason: articles.whyWritten,
          summary: articles.summary,
          saved: sql<boolean>`exists (
            select 1 from ${savedArticles}
            where ${savedArticles.userId} = ${claims.sub}
              and ${savedArticles.articleId} = ${articles.id}
          )`,
          completed: sql<boolean>`exists (
            select 1 from ${readingEvents}
            where ${readingEvents.userId} = ${claims.sub}
              and ${readingEvents.articleId} = ${articles.id}
              and ${readingEvents.eventType} = 'completed'
          )`,
        })
        .from(articles)
        .where(
          and(
            eq(articles.ownerId, claims.sub),
            eq(articles.learningThreadId, loopId),
            eq(articles.status, "published"),
          ),
        )
        .orderBy(desc(articles.researchedAt), desc(articles.id))
        .limit(limit),
      transaction
        .select({
          id: publicStarterEditionArticles.id,
          reason: publicStarterEditionArticles.reason,
          snapshot: publicStarterEditionArticles.snapshot,
          position: learningLoopPublicArticles.position,
        })
        .from(learningLoopPublicArticles)
        .innerJoin(
          publicStarterEditionArticles,
          eq(
            publicStarterEditionArticles.id,
            learningLoopPublicArticles.publicArticleId,
          ),
        )
        .innerJoin(
          publicStarterEditions,
          eq(publicStarterEditions.id, publicStarterEditionArticles.editionId),
        )
        .where(
          and(
            eq(learningLoopPublicArticles.loopId, loopId),
            eq(learningLoopPublicArticles.userId, claims.sub),
            inArray(publicStarterEditions.status, ["published", "archived"]),
            lte(publicStarterEditions.publishedAt, new Date()),
          ),
        )
        .orderBy(asc(learningLoopPublicArticles.position))
        .limit(limit),
    ]);

    const privateCards: LearningLoopArticleCard[] = privateRows.map((row) => ({
      id: row.id,
      visibility: "private",
      slug: row.slug,
      category: articleCategorySchema.parse(row.category),
      kicker: row.kicker,
      title: row.title,
      deck: row.deck,
      readingMinutes: row.readingMinutes,
      sourceCount: row.sourceCount,
      researchedAt: row.researchedAt.toISOString(),
      reason: row.reason,
      summary: row.summary as string[],
      saved: row.saved,
      completed: row.completed,
    }));
    const publicCards: LearningLoopArticleCard[] = publicRows.map((row) => {
      const snapshot = sharedArticleSnapshotSchema.parse(row.snapshot);
      return {
        id: row.id,
        visibility: "public",
        slug: null,
        category: snapshot.category,
        kicker: snapshot.kicker,
        title: snapshot.title,
        deck: snapshot.deck,
        readingMinutes: snapshot.readingMinutes,
        sourceCount: snapshot.sourceCount,
        researchedAt: snapshot.researchedAt,
        reason: row.reason,
        summary: snapshot.summary,
        saved: false,
        completed: false,
      };
    });
    const items = [...privateCards, ...publicCards]
      .sort(
        (left, right) =>
          Date.parse(right.researchedAt) - Date.parse(left.researchedAt) ||
          left.visibility.localeCompare(right.visibility) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit);

    return learningLoopArticlesResponseSchema.parse({
      loopId,
      items,
      itemCount: items.length,
    });
  });
}
