import { and, eq, sql } from "drizzle-orm";
import {
  editorialDirectionStates,
  type UserTransaction,
} from "@edison/db";
import { dateKeyInTimeZone } from "@edison/domain";

export type NewsEditionTransition =
  | "initialized"
  | "rotated"
  | "current"
  | "superseded";

export function planNewsEditionTransition(
  currentEditionDate: string | null,
  requestedEditionDate: string,
): NewsEditionTransition {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedEditionDate)) {
    throw new Error("News edition dates must use YYYY-MM-DD.");
  }
  if (currentEditionDate === null) return "initialized";
  if (currentEditionDate === requestedEditionDate) return "current";
  return currentEditionDate < requestedEditionDate ? "rotated" : "superseded";
}

export function newsEditionDateIsInFutureUtc(
  requestedEditionDate: string,
  now: Date = new Date(),
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedEditionDate)) {
    throw new Error("News edition dates must use YYYY-MM-DD.");
  }
  return requestedEditionDate > dateKeyInTimeZone(now, "UTC");
}

/**
 * Establishes or advances one reader's News edition while holding the section
 * state row lock. Callers decide whether edition creation belongs in the same
 * transaction; the daily scheduler does so before inserting its generation
 * jobs. A request for an older local date never rotates state backwards.
 */
export async function ensureNewsEditionForDate(
  transaction: UserTransaction,
  userId: string,
  requestedEditionDate: string,
) {
  const [state] = await transaction
    .select()
    .from(editorialDirectionStates)
    .where(
      and(
        eq(editorialDirectionStates.userId, userId),
        eq(editorialDirectionStates.section, "news"),
      ),
    )
    .for("update")
    .limit(1);

  if (!state) {
    throw new Error("The reader's News editorial-direction state is missing.");
  }

  const transition = planNewsEditionTransition(
    state.currentEditionDate,
    requestedEditionDate,
  );
  if (transition === "current" || transition === "superseded") {
    return { state, transition };
  }

  const values =
    transition === "initialized"
      ? { currentEditionDate: requestedEditionDate }
      : {
          currentEditionDate: requestedEditionDate,
          currentEditionId: crypto.randomUUID(),
          revision: sql`${editorialDirectionStates.revision} + 1`,
        };
  const [updated] = await transaction
    .update(editorialDirectionStates)
    .set(values)
    .where(
      and(
        eq(editorialDirectionStates.userId, userId),
        eq(editorialDirectionStates.section, "news"),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error("The reader's News edition could not be advanced.");
  }
  return { state: updated, transition };
}
