import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import {
  maxLearningLoops,
} from "@edison/contracts";
import {
  alphaMemberships,
  generationJobs,
  getDb,
  learningThreads,
  profiles,
} from "@edison/db";
import {
  dailyEditionIdempotencyKey,
  dailyEditionTimeInZone,
} from "@edison/domain";
import { safeCaughtErrorMetadata } from "../observability/safe-error";
import { dispatchGenerationJob } from "./generation-jobs";
import { selectLearningLoopForDailySlot } from "./learning-loop-rules";
import { ensureNewsEditionForDate } from "./news-editions";

const DEFAULT_DAILY_TARGET = 3;
const DEFAULT_LOCAL_HOUR = 5;
const DEFAULT_READER_BATCH_SIZE = 25;
export const MAX_DAILY_SLOT_ATTEMPTS = 2;

export function dailyEditionAttemptIdempotencyKey(
  dateKey: string,
  slot: number,
  attempt: number,
) {
  const base = dailyEditionIdempotencyKey(dateKey, slot);
  return attempt === 1 ? base : `${base}:attempt:${attempt}`;
}

type DailySlotJobState = {
  idempotencyKey: string;
  status: string;
  outputArticleId?: string | null;
};

export function planDailySlotAttempt(
  dateKey: string,
  slot: number,
  existing: readonly DailySlotJobState[],
):
  | { outcome: "satisfied" }
  | { outcome: "exhausted" }
  | { outcome: "create"; attempt: number; idempotencyKey: string } {
  const attempts = Array.from(
    { length: MAX_DAILY_SLOT_ATTEMPTS },
    (_, index) => ({
      attempt: index + 1,
      idempotencyKey: dailyEditionAttemptIdempotencyKey(
        dateKey,
        slot,
        index + 1,
      ),
    }),
  );
  const matching = attempts.flatMap((attempt) => {
    const row = existing.find(
      (candidate) => candidate.idempotencyKey === attempt.idempotencyKey,
    );
    return row ? [{ ...attempt, row }] : [];
  });
  if (
    matching.some(
      ({ row }) =>
        Boolean(row.outputArticleId) ||
        row.status === "queued" ||
        row.status === "running" ||
        row.status === "succeeded",
    )
  ) {
    return { outcome: "satisfied" };
  }

  const highestAttempt = matching.reduce(
    (highest, candidate) => Math.max(highest, candidate.attempt),
    0,
  );
  if (highestAttempt >= MAX_DAILY_SLOT_ATTEMPTS) {
    return { outcome: "exhausted" };
  }
  const attempt = highestAttempt + 1;
  return {
    outcome: "create",
    attempt,
    idempotencyKey: dailyEditionAttemptIdempotencyKey(
      dateKey,
      slot,
      attempt,
    ),
  };
}

function boundedIntegerSetting(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

/**
 * Schedules the morning edition after the configured local hour. Continuing to
 * consider a timezone for the rest of its local day lets a delayed cron or a
 * multi-batch alpha catch up without ever creating duplicate jobs.
 */
export async function scheduleDailyEditions(now = new Date()) {
  const target = boundedIntegerSetting(
    "EDISON_DAILY_EDITION_TARGET",
    DEFAULT_DAILY_TARGET,
    1,
    10,
  );
  const localHour = boundedIntegerSetting(
    "EDISON_DAILY_EDITION_LOCAL_HOUR",
    DEFAULT_LOCAL_HOUR,
    0,
    23,
  );
  const batchSize = boundedIntegerSetting(
    "EDISON_DAILY_EDITION_BATCH_SIZE",
    DEFAULT_READER_BATCH_SIZE,
    1,
    100,
  );
  const generationLimit = boundedIntegerSetting(
    "OPENAI_MAX_DAILY_GENERATIONS",
    8,
    1,
    100,
  );
  const database = getDb();

  const timeZoneRows = await database
    .selectDistinct({ timeZone: profiles.timezone })
    .from(profiles)
    .innerJoin(
      alphaMemberships,
      and(
        eq(alphaMemberships.userId, profiles.id),
        eq(alphaMemberships.status, "active"),
      ),
    )
    .where(eq(profiles.onboardingComplete, true))
    .orderBy(asc(profiles.timezone));

  const dueTimeZones: Array<{ timeZone: string; dateKey: string }> = [];
  let invalidTimeZones = 0;
  for (const row of timeZoneRows) {
    const local = dailyEditionTimeInZone(now, row.timeZone);
    if (!local) {
      invalidTimeZones += 1;
      console.error("Skipping invalid reader timezone during daily scheduling", {
        timeZone: row.timeZone,
      });
      continue;
    }
    if (local.hour >= localHour) {
      dueTimeZones.push({ timeZone: row.timeZone, dateKey: local.dateKey });
    }
  }

  const readers: Array<{
    userId: string;
    timeZone: string;
    dateKey: string;
  }> = [];
  let truncated = false;

  for (const due of dueTimeZones) {
    const remaining = batchSize - readers.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    // A slot is complete while work is pending/successful, or terminal when
    // its bounded final attempt exists. Readers with any retryable/missing slot
    // remain selectable without letting completed readers starve later batches.
    const slotNeedsWork = or(
      ...Array.from({ length: target }, (_, index) => {
        const slot = index + 1;
        const attemptKeys = Array.from(
          { length: MAX_DAILY_SLOT_ATTEMPTS },
          (__, attemptIndex) =>
            dailyEditionAttemptIdempotencyKey(
              due.dateKey,
              slot,
              attemptIndex + 1,
            ),
        );
        const finalAttemptKey = attemptKeys.at(-1)!;
        return notExists(
          database
            .select({ id: generationJobs.id })
            .from(generationJobs)
            .where(
              and(
                eq(generationJobs.userId, profiles.id),
                inArray(generationJobs.idempotencyKey, attemptKeys),
                or(
                  inArray(generationJobs.status, [
                    "queued",
                    "running",
                    "succeeded",
                  ]),
                  isNotNull(generationJobs.outputArticleId),
                  eq(generationJobs.idempotencyKey, finalAttemptKey),
                ),
              ),
            ),
        );
      }),
    );
    const rows = await database
      .select({ userId: profiles.id, timeZone: profiles.timezone })
      .from(profiles)
      .innerJoin(
        alphaMemberships,
        and(
          eq(alphaMemberships.userId, profiles.id),
          eq(alphaMemberships.status, "active"),
        ),
      )
      .where(
        and(
          eq(profiles.onboardingComplete, true),
          eq(profiles.timezone, due.timeZone),
          slotNeedsWork,
        ),
      )
      .orderBy(asc(profiles.id))
      .limit(remaining + 1);

    if (rows.length > remaining) truncated = true;
    readers.push(
      ...rows.slice(0, remaining).map((row) => ({
        ...row,
        dateKey: due.dateKey,
      })),
    );
  }

  const createdJobs: Array<{ id: string }> = [];
  let jobsPlanned = 0;
  let jobsAlreadyPresent = 0;
  let jobsDeferredByLimit = 0;
  let jobsSkippedByNewerEdition = 0;
  let retryJobsCreated = 0;
  let slotsRetryExhausted = 0;
  let editionsInitialized = 0;
  let editionsRotated = 0;
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const reader of readers) {
    const allAttemptKeys = Array.from({ length: target }, (_, index) =>
      Array.from({ length: MAX_DAILY_SLOT_ATTEMPTS }, (__, attemptIndex) =>
        dailyEditionAttemptIdempotencyKey(
          reader.dateKey,
          index + 1,
          attemptIndex + 1,
        ),
      ),
    ).flat();
    const result = await database.transaction(async (transaction) => {
      // Manual generation uses the same lock, making quota reservation atomic
      // across API requests and the scheduler.
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`edison-generation:${reader.userId}`}, 0)
        )
      `);

      const [existingRows, [{ value: recentCount }], activeLoops] =
        await Promise.all([
        transaction
          .select({
            idempotencyKey: generationJobs.idempotencyKey,
            status: generationJobs.status,
            outputArticleId: generationJobs.outputArticleId,
          })
          .from(generationJobs)
          .where(
            and(
              eq(generationJobs.userId, reader.userId),
              inArray(generationJobs.idempotencyKey, allAttemptKeys),
            ),
          ),
        transaction
          .select({ value: count() })
          .from(generationJobs)
          .where(
            and(
              eq(generationJobs.userId, reader.userId),
              gte(generationJobs.createdAt, since),
            ),
          ),
        transaction
          .select({ id: learningThreads.id })
          .from(learningThreads)
          .where(
            and(
              eq(learningThreads.userId, reader.userId),
              eq(learningThreads.status, "active"),
            ),
          )
          .orderBy(asc(learningThreads.createdAt), asc(learningThreads.id))
          .limit(maxLearningLoops + 1),
      ]);
      if (activeLoops.length > maxLearningLoops) {
        throw new Error(
          "The reader has more active learning loops than the scheduler can safely rotate.",
        );
      }

      const plans = Array.from({ length: target }, (_, index) => {
        const slot = index + 1;
        return {
          slot,
          plan: planDailySlotAttempt(
            reader.dateKey,
            slot,
            existingRows,
          ),
        };
      });
      const jobsNeeded = plans.flatMap(({ slot, plan }) => {
        if (plan.outcome !== "create") return [];
        const learningLoop = selectLearningLoopForDailySlot(
          activeLoops,
          reader.dateKey,
          slot,
        );
        return [
          {
            userId: reader.userId,
            kind: learningLoop
              ? ("learning-thread" as const)
              : ("initial-edition" as const),
            idempotencyKey: plan.idempotencyKey,
            input: {
              source: "daily-edition-scheduler",
              editionDate: reader.dateKey,
              slot,
              target,
              dailyAttempt: plan.attempt,
              learningLoopId: learningLoop?.id,
            },
          },
        ];
      });
      const remainingCapacity = Math.max(0, generationLimit - recentCount);
      const deferredByLimit = Math.max(
        0,
        jobsNeeded.length - remainingCapacity,
      );
      const jobsToCreate = jobsNeeded.slice(0, remainingCapacity);
      if (!existingRows.length && !jobsToCreate.length) {
        return {
          created: [],
          deferredByLimit,
          existing: existingRows.length,
          transition: null,
          skippedByNewerEdition: 0,
          planned: jobsNeeded.length,
          retriesCreated: 0,
          retriesExhausted: plans.filter(
            ({ plan }) => plan.outcome === "exhausted",
          ).length,
        };
      }

      // The state rotation and the first durable jobs for this local date share
      // one transaction. Changing currentEditionId invalidates old temporary
      // directions and increments revision, so stale edits and Undo fail closed.
      const lifecycle = await ensureNewsEditionForDate(
        transaction,
        reader.userId,
        reader.dateKey,
      );
      if (lifecycle.transition === "superseded") {
        return {
          created: [],
          deferredByLimit,
          existing: existingRows.length,
          transition: lifecycle.transition,
          skippedByNewerEdition: jobsNeeded.length,
          planned: jobsNeeded.length,
          retriesCreated: 0,
          retriesExhausted: 0,
        };
      }

      if (!jobsToCreate.length) {
        return {
          created: [],
          deferredByLimit,
          existing: existingRows.length,
          transition: lifecycle.transition,
          skippedByNewerEdition: 0,
          planned: jobsNeeded.length,
          retriesCreated: 0,
          retriesExhausted: plans.filter(
            ({ plan }) => plan.outcome === "exhausted",
          ).length,
        };
      }

      const created = await transaction
        .insert(generationJobs)
        .values(
          jobsToCreate.map((job) => ({
            ...job,
            input: {
              ...job.input,
              newsEditionId: lifecycle.state.currentEditionId,
            },
          })),
        )
        .onConflictDoNothing()
        .returning({ id: generationJobs.id });
      return {
        created,
        deferredByLimit,
        existing: existingRows.length,
        transition: lifecycle.transition,
        skippedByNewerEdition: 0,
        planned: jobsNeeded.length,
        retriesCreated: jobsToCreate.filter(
          (job) => job.input.dailyAttempt > 1,
        ).length,
        retriesExhausted: plans.filter(
          ({ plan }) => plan.outcome === "exhausted",
        ).length,
      };
    });
    createdJobs.push(...result.created);
    jobsPlanned += result.planned;
    jobsAlreadyPresent += result.existing;
    jobsDeferredByLimit += result.deferredByLimit;
    jobsSkippedByNewerEdition += result.skippedByNewerEdition;
    retryJobsCreated += result.retriesCreated;
    slotsRetryExhausted += result.retriesExhausted;
    if (result.transition === "initialized") editionsInitialized += 1;
    if (result.transition === "rotated") editionsRotated += 1;
  }

  let dispatched = 0;
  let alreadyDispatched = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of createdJobs) {
    try {
      const result = await dispatchGenerationJob(job.id);
      if (result.outcome === "dispatched") dispatched += 1;
      if (result.outcome === "already-dispatched") alreadyDispatched += 1;
      if (result.outcome === "skipped") skipped += 1;
    } catch (error) {
      failed += 1;
      console.error("Daily-edition workflow dispatch failed", {
        jobId: job.id,
        ...safeCaughtErrorMetadata(error),
      });
    }
  }

  return {
    target,
    localHour,
    batchSize,
    generationLimit,
    timeZonesExamined: timeZoneRows.length,
    dueTimeZones: dueTimeZones.length,
    invalidTimeZones,
    readersSelected: readers.length,
    jobsPlanned,
    jobsCreated: createdJobs.length,
    jobsAlreadyPresent,
    jobsDeferredByLimit,
    jobsSkippedByNewerEdition,
    retryJobsCreated,
    slotsRetryExhausted,
    editionsInitialized,
    editionsRotated,
    dispatched,
    alreadyDispatched,
    skipped,
    failed,
    truncated,
  };
}
