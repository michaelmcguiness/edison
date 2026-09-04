import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  notExists,
  sql,
} from "drizzle-orm";
import {
  alphaMemberships,
  generationJobs,
  getDb,
  profiles,
} from "@edison/db";
import {
  dailyEditionIdempotencyKey,
  dailyEditionTimeInZone,
} from "@edison/domain";
import { dispatchGenerationJob } from "./generation-jobs";

const DEFAULT_DAILY_TARGET = 3;
const DEFAULT_LOCAL_HOUR = 5;
const DEFAULT_READER_BATCH_SIZE = 25;

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

    // The highest slot is a durable marker that the whole configured target
    // was inserted. Raising the target later naturally selects the reader again.
    const markerKey = dailyEditionIdempotencyKey(due.dateKey, target);
    const missingMarker = notExists(
      database
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.userId, profiles.id),
            eq(generationJobs.idempotencyKey, markerKey),
          ),
        ),
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
          missingMarker,
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

  const plannedJobs = readers.flatMap((reader) =>
    Array.from({ length: target }, (_, index) => {
      const slot = index + 1;
      return {
        userId: reader.userId,
        kind: "initial-edition" as const,
        idempotencyKey: dailyEditionIdempotencyKey(reader.dateKey, slot),
        input: {
          source: "daily-edition-scheduler",
          editionDate: reader.dateKey,
          slot,
          target,
        },
      };
    }),
  );
  const createdJobs: Array<{ id: string }> = [];
  let jobsAlreadyPresent = 0;
  let jobsDeferredByLimit = 0;
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const reader of readers) {
    const readerJobs = plannedJobs.filter(
      (job) => job.userId === reader.userId,
    );
    const createdForReader = await database.transaction(async (transaction) => {
      // Manual generation uses the same lock, making quota reservation atomic
      // across API requests and the scheduler.
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`edison-generation:${reader.userId}`}, 0)
        )
      `);

      const [existingRows, [{ value: recentCount }]] = await Promise.all([
        transaction
          .select({ idempotencyKey: generationJobs.idempotencyKey })
          .from(generationJobs)
          .where(
            and(
              eq(generationJobs.userId, reader.userId),
              inArray(
                generationJobs.idempotencyKey,
                readerJobs.map((job) => job.idempotencyKey),
              ),
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
      ]);

      const existingKeys = new Set(
        existingRows.map((job) => job.idempotencyKey),
      );
      const missingJobs = readerJobs.filter(
        (job) => !existingKeys.has(job.idempotencyKey),
      );
      const remainingCapacity = Math.max(0, generationLimit - recentCount);
      jobsAlreadyPresent += existingRows.length;
      jobsDeferredByLimit += Math.max(
        0,
        missingJobs.length - remainingCapacity,
      );
      const jobsToCreate = missingJobs.slice(0, remainingCapacity);
      if (!jobsToCreate.length) return [];

      return transaction
        .insert(generationJobs)
        .values(jobsToCreate)
        .onConflictDoNothing()
        .returning({ id: generationJobs.id });
    });
    createdJobs.push(...createdForReader);
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
        error,
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
    jobsPlanned: plannedJobs.length,
    jobsCreated: createdJobs.length,
    jobsAlreadyPresent,
    jobsDeferredByLimit,
    dispatched,
    alreadyDispatched,
    skipped,
    failed,
    truncated,
  };
}
