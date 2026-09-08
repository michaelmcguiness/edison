export function normalizeLearningLoopTitle(title: string) {
  return title
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

export function normalizeLearningLoopDisplayTitle(title: string) {
  return title.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function latestReversibleLearningLoopMutationId(
  currentRevision: number,
  history: readonly {
    id: string;
    operation: string;
    resultingRevision: number;
    revertedByMutationId: string | null;
  }[],
) {
  const latest = history[0];
  return latest?.operation === "set" &&
    latest.revertedByMutationId === null &&
    latest.resultingRevision === currentRevision
    ? latest.id
    : null;
}

export function selectLearningLoopForDailySlot<T>(
  loops: readonly T[],
  dateKey: string,
  slot: number,
) {
  if (!loops.length) return undefined;
  const day = Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000;
  if (!Number.isInteger(day) || !Number.isInteger(slot) || slot < 1) {
    throw new TypeError("A loop assignment requires a valid date and slot.");
  }
  return loops[(day + slot - 1) % loops.length];
}
