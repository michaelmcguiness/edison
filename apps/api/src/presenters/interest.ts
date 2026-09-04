import { explicitInterestSchema, type ExplicitInterest } from "@edison/contracts";
import type { userInterests } from "@edison/db";

type InterestRecord = Pick<
  typeof userInterests.$inferSelect,
  "id" | "kind" | "status" | "topic"
>;

export function presentExplicitInterest(
  interest: InterestRecord,
): ExplicitInterest | null {
  if (
    interest.kind !== "explicit" ||
    (interest.status !== "active" && interest.status !== "muted")
  ) {
    return null;
  }

  return explicitInterestSchema.parse({
    id: interest.id,
    topic: interest.topic,
    status: interest.status,
  });
}

export function presentExplicitInterests(interests: InterestRecord[]) {
  return interests
    .flatMap((interest) => {
      const presented = presentExplicitInterest(interest);
      return presented ? [presented] : [];
    })
    .sort((left, right) => left.topic.localeCompare(right.topic));
}
