import type { KnowledgeStateEntry, PreferenceChange } from "@edison/contracts";
import {
  maxKnowledgeStateItems,
  maxRetainedExplicitInterests,
} from "@edison/contracts";
import { normalizeInterestTopic } from "@edison/domain";

type InterestCapacityRecord = {
  id?: string;
  kind: string;
  status: string;
};

export type { KnowledgeStateEntry };

export function isRetainedExplicitInterest(
  interest: InterestCapacityRecord,
) {
  return interest.kind === "explicit" && interest.status !== "deleted";
}

export function retainedExplicitInterestCount(
  interests: InterestCapacityRecord[],
) {
  return interests.filter(isRetainedExplicitInterest).length;
}

export function canRetainExplicitInterest(
  interests: InterestCapacityRecord[],
  existing?: InterestCapacityRecord,
) {
  return (
    (existing !== undefined && isRetainedExplicitInterest(existing)) ||
    retainedExplicitInterestCount(interests) < maxRetainedExplicitInterests
  );
}

export function applyKnowledgeStateChange(
  current: KnowledgeStateEntry[],
  change: Extract<PreferenceChange, { path: "knowledgeState" }>,
) {
  const next = [...current];
  const requestedTopics = Array.isArray(change.value)
    ? change.value
    : [change.value];
  const appliedTopics: string[] = [];

  for (const requestedTopic of requestedTopics) {
    const topic = requestedTopic.trim();
    const key = normalizeInterestTopic(topic);
    if (!key) continue;

    const existingIndex = next.findIndex(
      (item) => normalizeInterestTopic(item.topic) === key,
    );

    if (change.operation === "remove") {
      if (existingIndex < 0) continue;
      const [removed] = next.splice(existingIndex, 1);
      if (removed) appliedTopics.push(removed.topic);
      continue;
    }

    const candidate = {
      topic,
      level: "intermediate" as const,
      note: change.explanation,
    };
    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      if (
        existing?.topic === candidate.topic &&
        existing.level === candidate.level &&
        existing.note === candidate.note
      ) {
        continue;
      }
      next[existingIndex] = candidate;
      appliedTopics.push(topic);
      continue;
    }
    if (next.length >= maxKnowledgeStateItems) continue;

    next.push(candidate);
    appliedTopics.push(topic);
  }

  return { knowledgeState: next, appliedTopics };
}
