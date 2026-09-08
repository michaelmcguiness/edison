import {
  and,
  count,
  eq,
  gte,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  aiRequestReservations,
  getDb,
  usageLedger,
  type UserTransaction,
} from "@edison/db";
import {
  UnpricedOpenAiModelError,
  estimatedArticleCostMicrousd,
} from "@edison/domain";
import { HttpError } from "../http/errors";

export const aiRequestOperations = [
  "article_qa",
  "preference_command",
] as const;

export type AiRequestOperation = (typeof aiRequestOperations)[number];
export type AiRequestReservation =
  typeof aiRequestReservations.$inferSelect;

export class AiUsagePersistenceError extends Error {
  constructor() {
    super("AI usage persistence failed");
    this.name = "AiUsagePersistenceError";
  }
}

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const AI_REQUEST_LEASE_MS = 3 * 60 * 1_000;
export const AI_REQUEST_PROVIDER_TIMEOUT_MS = 2 * 60 * 1_000;
export const AI_REQUEST_MAX_ATTEMPTS = 3;
const AI_REQUEST_RETRY_DELAY_MS = 3_000;

const quotaConfiguration: Record<
  AiRequestOperation,
  {
    environmentName: string;
    errorCode: string;
    exhaustedCode: string;
    unavailableMessage: string;
    exhaustedMessage: string;
  }
> = {
  article_qa: {
    environmentName: "OPENAI_MAX_DAILY_ARTICLE_QUESTIONS",
    errorCode: "article_question_limit_not_configured",
    exhaustedCode: "article_question_limit_reached",
    unavailableMessage:
      "Article questions are unavailable because their daily limit is invalid.",
    exhaustedMessage:
      "This reader's article-question limit has been reached for the last 24 hours.",
  },
  preference_command: {
    environmentName: "OPENAI_MAX_DAILY_FEED_COMMANDS",
    errorCode: "feed_command_limit_not_configured",
    exhaustedCode: "feed_command_limit_reached",
    unavailableMessage:
      "Feed commands are unavailable because their daily limit is invalid.",
    exhaustedMessage:
      "This reader's feed-command limit has been reached for the last 24 hours.",
  },
};

export function configuredAiRequestLimit(
  operation: AiRequestOperation,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const configuration = quotaConfiguration[operation];
  const raw = environment[configuration.environmentName]?.trim() ?? "";
  const limit = Number(raw);
  if (!raw || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new HttpError(
      503,
      configuration.errorCode,
      configuration.unavailableMessage,
    );
  }
  return limit;
}

export function providerIdempotencyKey(reservationId: string) {
  return `edison-ai-${reservationId}`;
}

export function aiRequestRetryAt(now: Date, retryNotBefore?: Date | null) {
  const minimumDelay = new Date(now.getTime() + AI_REQUEST_RETRY_DELAY_MS);
  return retryNotBefore && retryNotBefore > minimumDelay
    ? retryNotBefore
    : minimumDelay;
}

export type ObservedUsagePersistence =
  | "persisted"
  | "persisted_unpriced"
  | "failed";

export function invalidProviderResponseFailure(
  usagePersistence: ObservedUsagePersistence,
) {
  if (usagePersistence === "failed") {
    return {
      terminal: false,
      preserveRetryCapacity: true,
      failureCode: "ai_usage_persistence_failed",
    } as const;
  }
  return {
    terminal: true,
    preserveRetryCapacity: false,
    failureCode:
      usagePersistence === "persisted_unpriced"
        ? "provider_response_invalid_unpriced"
        : "provider_response_invalid",
  } as const;
}

export async function reserveAiRequest(
  transaction: UserTransaction,
  input: {
    userId: string;
    operation: AiRequestOperation;
    resourceId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    requestSnapshot: Record<string, unknown>;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const limit = configuredAiRequestLimit(input.operation);

  // Every path reserving this operation uses the same transaction-scoped lock,
  // so counting and inserting remain atomic under concurrent serverless calls.
  await transaction.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(
        ${`edison-ai-quota:${input.operation}:${input.userId}`},
        0
      )
    )
  `);

  const [existing] = await transaction
    .select()
    .from(aiRequestReservations)
    .where(
      and(
        eq(aiRequestReservations.userId, input.userId),
        eq(aiRequestReservations.operation, input.operation),
        eq(aiRequestReservations.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.requestFingerprint !== input.requestFingerprint) {
      throw new HttpError(
        409,
        "idempotency_key_reused",
        "That idempotency key was already used for a different AI request.",
      );
    }
    return { reservation: existing, created: false as const };
  }

  const since = new Date(now.getTime() - ROLLING_WINDOW_MS);
  const [{ value: recentCount }] = await transaction
    .select({ value: count() })
    .from(aiRequestReservations)
    .where(
      and(
        eq(aiRequestReservations.userId, input.userId),
        eq(aiRequestReservations.operation, input.operation),
        gte(aiRequestReservations.createdAt, since),
      ),
    );

  if (recentCount >= limit) {
    const configuration = quotaConfiguration[input.operation];
    throw new HttpError(
      429,
      configuration.exhaustedCode,
      configuration.exhaustedMessage,
    );
  }

  const [created] = await transaction
    .insert(aiRequestReservations)
    .values({
      userId: input.userId,
      operation: input.operation,
      resourceId: input.resourceId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      requestSnapshot: input.requestSnapshot,
      nextAttemptAt: now,
    })
    .returning();

  if (!created) {
    throw new HttpError(
      500,
      "ai_request_reservation_failed",
      "Edison could not reserve that AI request.",
    );
  }
  return { reservation: created, created: true as const };
}

export type ReservationClaimDisposition =
  | "claimable"
  | "busy"
  | "succeeded"
  | "failed";

export function reservationClaimDisposition(
  reservation: Pick<
    AiRequestReservation,
    "status" | "attemptCount" | "leaseExpiresAt" | "nextAttemptAt"
  >,
  now: Date,
): ReservationClaimDisposition {
  if (reservation.status === "succeeded") return "succeeded";
  if (reservation.status === "failed") return "failed";
  if (
    reservation.status === "in_progress" &&
    reservation.leaseExpiresAt &&
    reservation.leaseExpiresAt > now
  ) {
    return "busy";
  }
  if (reservation.attemptCount >= AI_REQUEST_MAX_ATTEMPTS) return "failed";
  if (reservation.nextAttemptAt > now) return "busy";
  return "claimable";
}

export type AiRequestClaimResult =
  | {
      outcome: "claimed";
      reservation: AiRequestReservation;
      leaseOwner: string;
      providerIdempotencyKey: string;
    }
  | {
      outcome: "busy";
      reservation: AiRequestReservation;
      retryAt: Date;
    }
  | {
      outcome: "succeeded";
      reservation: AiRequestReservation;
    }
  | {
      outcome: "failed";
      reservation: AiRequestReservation;
    };

export async function claimAiRequest(input: {
  reservationId: string;
  userId: string;
  operation: AiRequestOperation;
  now?: Date;
}): Promise<AiRequestClaimResult> {
  const now = input.now ?? new Date();
  const leaseOwner = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + AI_REQUEST_LEASE_MS);
  const database = getDb();

  const [claimed] = await database
    .update(aiRequestReservations)
    .set({
      status: "in_progress",
      attemptCount: sql`${aiRequestReservations.attemptCount} + 1`,
      leaseOwner,
      leaseExpiresAt,
      startedAt: sql`coalesce(${aiRequestReservations.startedAt}, ${now})`,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiRequestReservations.id, input.reservationId),
        eq(aiRequestReservations.userId, input.userId),
        eq(aiRequestReservations.operation, input.operation),
        lt(aiRequestReservations.attemptCount, AI_REQUEST_MAX_ATTEMPTS),
        lte(aiRequestReservations.nextAttemptAt, now),
        or(
          eq(aiRequestReservations.status, "reserved"),
          and(
            eq(aiRequestReservations.status, "in_progress"),
            lte(aiRequestReservations.leaseExpiresAt, now),
          ),
        ),
      ),
    )
    .returning();

  if (claimed) {
    return {
      outcome: "claimed",
      reservation: claimed,
      leaseOwner,
      providerIdempotencyKey: providerIdempotencyKey(claimed.id),
    };
  }

  const [current] = await database
    .select()
    .from(aiRequestReservations)
    .where(
      and(
        eq(aiRequestReservations.id, input.reservationId),
        eq(aiRequestReservations.userId, input.userId),
        eq(aiRequestReservations.operation, input.operation),
      ),
    )
    .limit(1);
  if (!current) {
    throw new HttpError(
      404,
      "ai_request_reservation_not_found",
      "That AI request reservation was not found.",
    );
  }

  const disposition = reservationClaimDisposition(current, now);
  if (disposition === "busy" || disposition === "claimable") {
    const retryAt = [current.nextAttemptAt, current.leaseExpiresAt]
      .filter((value): value is Date => Boolean(value))
      .reduce((latest, value) => (value > latest ? value : latest), now);
    return { outcome: "busy", reservation: current, retryAt };
  }
  if (disposition === "failed" && current.status !== "failed") {
    const [terminal] = await database
      .update(aiRequestReservations)
      .set({
        status: "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: sql`coalesce(${aiRequestReservations.lastError}, 'ai_request_attempts_exhausted')`,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiRequestReservations.id, current.id),
          eq(aiRequestReservations.userId, input.userId),
          eq(aiRequestReservations.operation, input.operation),
          gte(
            aiRequestReservations.attemptCount,
            AI_REQUEST_MAX_ATTEMPTS,
          ),
          or(
            eq(aiRequestReservations.status, "reserved"),
            and(
              eq(aiRequestReservations.status, "in_progress"),
              lte(aiRequestReservations.leaseExpiresAt, now),
            ),
          ),
        ),
      )
      .returning();
    return { outcome: "failed", reservation: terminal ?? current };
  }
  return { outcome: disposition, reservation: current };
}

export async function findAiRequestReservation(input: {
  userId: string;
  operation: AiRequestOperation;
  idempotencyKey: string;
}) {
  const [reservation] = await getDb()
    .select()
    .from(aiRequestReservations)
    .where(
      and(
        eq(aiRequestReservations.userId, input.userId),
        eq(aiRequestReservations.operation, input.operation),
        eq(aiRequestReservations.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  return reservation ?? null;
}

export type RecordedAiUsage = {
  providerResponseId: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  webSearchCalls?: number;
};

export function priceRecordedAiUsage(usage: RecordedAiUsage) {
  try {
    return {
      pricingStatus: "priced" as const,
      costMicrousd: estimatedArticleCostMicrousd({
        model: usage.model,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        webSearchCalls: usage.webSearchCalls ?? 0,
      }),
      pricingError: null,
    };
  } catch (error) {
    if (!(error instanceof UnpricedOpenAiModelError)) throw error;
    return {
      pricingStatus: "unpriced" as const,
      costMicrousd: null,
      pricingError: error,
    };
  }
}

/**
 * Persist observed provider usage immediately after a response returns. It is
 * intentionally separate from domain-result persistence: if that later write
 * fails, the spend remains visible and a retry can reuse the same provider
 * idempotency key. A distinct provider response ID is recorded if the provider
 * ever produces more than one response for the same reservation.
 */
export async function recordAiRequestSpend(input: {
  reservationId: string;
  userId: string;
  operation: AiRequestOperation;
  usage: RecordedAiUsage;
}) {
  const pricing = priceRecordedAiUsage(input.usage);

  const database = getDb();
  const result = await database.transaction(async (transaction) => {
    const [reservation] = await transaction
      .select({ id: aiRequestReservations.id })
      .from(aiRequestReservations)
      .where(
        and(
          eq(aiRequestReservations.id, input.reservationId),
          eq(aiRequestReservations.userId, input.userId),
          eq(aiRequestReservations.operation, input.operation),
        ),
      )
      .limit(1);
    if (!reservation) {
      throw new HttpError(
        404,
        "ai_request_reservation_not_found",
        "That AI request reservation was not found.",
      );
    }

    const webSearchCalls = input.usage.webSearchCalls ?? 0;
    const [created] = await transaction
      .insert(usageLedger)
      .values({
        userId: input.userId,
        aiRequestReservationId: input.reservationId,
        operation: input.operation,
        provider: "openai",
        providerResponseId: input.usage.providerResponseId,
        model: input.usage.model,
        inputTokens: input.usage.inputTokens,
        cachedInputTokens: input.usage.cachedInputTokens,
        outputTokens: input.usage.outputTokens,
        webSearchCalls,
        pricingStatus: pricing.pricingStatus,
        costMicrousd: pricing.costMicrousd,
      })
      .onConflictDoNothing()
      .returning({ id: usageLedger.id });

    const [stored] = await transaction
      .select({
        id: usageLedger.id,
        userId: usageLedger.userId,
        aiRequestReservationId: usageLedger.aiRequestReservationId,
        operation: usageLedger.operation,
        model: usageLedger.model,
        inputTokens: usageLedger.inputTokens,
        cachedInputTokens: usageLedger.cachedInputTokens,
        outputTokens: usageLedger.outputTokens,
        webSearchCalls: usageLedger.webSearchCalls,
        pricingStatus: usageLedger.pricingStatus,
        costMicrousd: usageLedger.costMicrousd,
      })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.provider, "openai"),
          eq(
            usageLedger.providerResponseId,
            input.usage.providerResponseId,
          ),
        ),
      )
      .limit(1);

    if (
      !stored ||
      stored.userId !== input.userId ||
      stored.aiRequestReservationId !== input.reservationId ||
      stored.operation !== input.operation ||
      stored.model !== input.usage.model ||
      stored.inputTokens !== input.usage.inputTokens ||
      stored.cachedInputTokens !== input.usage.cachedInputTokens ||
      stored.outputTokens !== input.usage.outputTokens ||
      stored.webSearchCalls !== webSearchCalls ||
      stored.pricingStatus !== pricing.pricingStatus ||
      stored.costMicrousd !== pricing.costMicrousd
    ) {
      throw new HttpError(
        500,
        "ai_usage_persistence_conflict",
        "Edison could not verify the provider usage record.",
      );
    }

    await transaction
      .update(aiRequestReservations)
      .set({
        providerResponseId: sql`coalesce(${aiRequestReservations.providerResponseId}, ${input.usage.providerResponseId})`,
        updatedAt: new Date(),
      })
      .where(eq(aiRequestReservations.id, input.reservationId));

    return { recorded: Boolean(created) };
  });
  // Persist the observed response and tokens first, then fail the logical
  // request closed so the unknown price is operationally visible.
  if (pricing.pricingError) throw pricing.pricingError;
  return result;
}

export async function finalizeAiRequest(
  transaction: UserTransaction,
  input: {
    reservationId: string;
    userId: string;
    operation: AiRequestOperation;
    leaseOwner: string;
    providerResponseId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [reservation] = await transaction
    .select()
    .from(aiRequestReservations)
    .where(
      and(
        eq(aiRequestReservations.id, input.reservationId),
        eq(aiRequestReservations.userId, input.userId),
        eq(aiRequestReservations.operation, input.operation),
      ),
    )
    .for("update")
    .limit(1);

  if (!reservation) {
    throw new HttpError(
      404,
      "ai_request_reservation_not_found",
      "That AI request reservation was not found.",
    );
  }
  if (reservation.status === "succeeded") return reservation;
  if (
    reservation.status !== "in_progress" ||
    reservation.leaseOwner !== input.leaseOwner
  ) {
    throw new HttpError(
      409,
      "ai_request_lease_lost",
      "That AI request is being completed by another worker.",
    );
  }

  const [recordedSpend] = await transaction
    .select({ id: usageLedger.id })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.aiRequestReservationId, input.reservationId),
        eq(usageLedger.provider, "openai"),
        eq(usageLedger.providerResponseId, input.providerResponseId),
      ),
    )
    .limit(1);
  if (!recordedSpend) {
    throw new HttpError(
      500,
      "ai_usage_not_recorded",
      "Edison could not verify the provider usage record.",
    );
  }

  const [completed] = await transaction
    .update(aiRequestReservations)
    .set({
      status: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      providerResponseId: input.providerResponseId,
      lastError: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiRequestReservations.id, input.reservationId),
        eq(aiRequestReservations.status, "in_progress"),
        eq(aiRequestReservations.leaseOwner, input.leaseOwner),
      ),
    )
    .returning();
  if (!completed) {
    throw new HttpError(
      409,
      "ai_request_lease_lost",
      "That AI request is being completed by another worker.",
    );
  }
  return completed;
}

export async function markAiRequestAttemptFailed(input: {
  reservationId: string;
  userId: string;
  operation: AiRequestOperation;
  leaseOwner: string;
  failureCode: string;
  terminal?: boolean;
  preserveRetryCapacity?: boolean;
  retryNotBefore?: Date | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nextAttemptAt = aiRequestRetryAt(now, input.retryNotBefore);
  const preserveRetryCapacity =
    Boolean(input.preserveRetryCapacity) && !input.terminal;
  const [updated] = await getDb()
    .update(aiRequestReservations)
    .set({
      status: input.terminal
        ? "failed"
        : preserveRetryCapacity
          ? "reserved"
          : sql`case
              when ${aiRequestReservations.attemptCount} >= ${AI_REQUEST_MAX_ATTEMPTS}
                then 'failed'
              else 'reserved'
            end`,
      attemptCount: preserveRetryCapacity
        ? sql`greatest(${aiRequestReservations.attemptCount} - 1, 0)`
        : aiRequestReservations.attemptCount,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt,
      lastError: input.failureCode,
      finishedAt: input.terminal
        ? now
        : preserveRetryCapacity
          ? null
          : sql`case
              when ${aiRequestReservations.attemptCount} >= ${AI_REQUEST_MAX_ATTEMPTS}
                then ${now}::timestamptz
              else null
            end`,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiRequestReservations.id, input.reservationId),
        eq(aiRequestReservations.userId, input.userId),
        eq(aiRequestReservations.operation, input.operation),
        eq(aiRequestReservations.status, "in_progress"),
        eq(aiRequestReservations.leaseOwner, input.leaseOwner),
      ),
    )
    .returning();
  return updated ?? null;
}
