import { createHash } from "node:crypto";
import {
  assertOnDemandEvidence, assertReaderFirstPreviousMessages, onDemandEvidenceSchema,
  type OnDemandEvidence, type ReaderFirstPreviousMessage, type ReaderFirstPreviousReference,
} from "@edison/ai";
import { demandAnswerSchema } from "@edison/contracts";
import { demandArtifactId } from "./demand-publication";
import { demandAnswerConversationText } from "./demand-result-compatibility";

const MAX_EVIDENCE_BYTES = 40_000;
type Source = OnDemandEvidence["sources"][number];
type Passage = OnDemandEvidence["passages"][number];
type Support = { reference: ReaderFirstPreviousReference; source?: Source; passages: Passage[] };
type HistoryEntry = { id: string; snapshot: unknown; result: unknown };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function savedEvidence(value: unknown): OnDemandEvidence | null {
  const parsed = onDemandEvidenceSchema.safeParse(value);
  if (!parsed.success) return null;
  try { assertOnDemandEvidence(parsed.data); return parsed.data; }
  catch { return null; }
}
function size(evidence: OnDemandEvidence) { return Buffer.byteLength(JSON.stringify(evidence), "utf8"); }
function passageIdentity(url: string, passage: Passage) {
  return JSON.stringify([url, passage.text, passage.locator, passage.provenance, passage.retrievedAt]);
}
function unusedKey(kind: "s" | "p", identity: string, occupied: Set<string>) {
  for (let nonce = 0; ; nonce += 1) {
    const hash = createHash("sha256").update(nonce ? `${identity}\n${nonce}` : identity).digest("hex");
    const key = `qh-${kind}-${hash.slice(0, 32)}`;
    if (!occupied.has(key)) return key;
  }
}

/** Resolve only this saved answer's source version. Display metadata alone is
 * never independently retrieved evidence, nor permission to fetch a URL. */
function support(reference: ReaderFirstPreviousReference, evidence: OnDemandEvidence | null): Support {
  const matches = evidence?.sources.filter((source) => canonicalUrl(source.url) === canonicalUrl(reference.url)) ?? [];
  if (matches.length !== 1 || !reference.accessedAt) return { reference, passages: [] };
  const source = matches[0];
  const retrieved = evidence!.passages.filter((passage) => passage.sourceId === source.id &&
    passage.provenance === "retrieved" && passage.retrievedAt !== null);
  // Publication displays the latest retrieval time across the source's retained
  // passages. Keep the actual older passages too, but never another version's
  // later text or an unsupported display timestamp.
  if (!retrieved.some((passage) => passage.retrievedAt === reference.accessedAt)) return { reference, passages: [] };
  const cutoff = Date.parse(reference.accessedAt);
  return { reference, source, passages: retrieved.filter((passage) => Date.parse(passage.retrievedAt!) <= cutoff) };
}

function historicalMessage(entry: HistoryEntry): { messages: ReaderFirstPreviousMessage[]; supports: Support[] } {
  const result = record(entry.result);
  const question = record(record(entry.snapshot).question);
  const answer = demandAnswerSchema.parse(result.answer);
  if (typeof question.question !== "string") throw new Error("Missing historical question");
  // A present but invalid final packet is unavailable, not a reason to substitute
  // a different snapshot. Legacy answers normally only have snapshot evidence.
  const evidence = savedEvidence(Object.hasOwn(result, "evidence") ? result.evidence : question.evidence);
  const references: ReaderFirstPreviousReference[] = [];
  if ("body" in answer) {
    for (const [index, source] of answer.sources.slice(0, 16).entries()) {
      if (!canonicalUrl(source.url)) continue;
      references.push({ label: String(index + 1), sourceId: source.id, title: source.title,
        url: source.url, accessedAt: source.accessedAt, evidenceSourceKey: null, passageIds: [] });
    }
  } else if (typeof question.articleVersion === "string") {
    for (const sourceId of answer.sourceIds) {
      const source = evidence?.sources.find((candidate) =>
        demandArtifactId(`${question.articleVersion}:source:${candidate.id}`) === sourceId);
      // Old source IDs without saved identity cannot truthfully yield a URL or
      // title. Preserve their original prose without inventing a reference.
      if (!source || !canonicalUrl(source.url) || references.some((reference) => reference.sourceId === sourceId)) continue;
      const accessedAt = evidence!.passages.find((passage) => passage.sourceId === source.id && passage.provenance === "retrieved")?.retrievedAt ?? null;
      references.push({ label: String(references.length + 1), sourceId, title: source.title, url: source.url,
        accessedAt, evidenceSourceKey: null, passageIds: [] });
      if (references.length === 16) break;
    }
  }
  return { messages: [{ role: "user", text: question.question },
    { role: "assistant", text: demandAnswerConversationText(answer), references }],
  supports: references.map((reference) => support(reference, evidence)) };
}

/** Admit prior-answer evidence into the existing article packet. Article bytes
 * are retained unchanged; newest answers get first use of the remaining space.
 * Keys and exact retrieval versions survive deterministic transaction replay. */
export function demandQuestionHistory(input: { articleEvidence: OnDemandEvidence; history: readonly HistoryEntry[] }): {
  evidence: OnDemandEvidence; previousMessages: ReaderFirstPreviousMessage[];
} {
  if (input.history.length > 6) throw new Error("Historical questions exceed the bounded conversation");
  const evidence = structuredClone(input.articleEvidence);
  assertOnDemandEvidence(evidence);
  if (size(evidence) > MAX_EVIDENCE_BYTES) throw new Error("Article evidence exceeds the bounded packet");
  const groups = input.history.map(historicalMessage);
  const sourceKeys = new Set(evidence.sources.map((source) => source.id));
  const passageKeys = new Set(evidence.passages.map((passage) => passage.id));
  const sourcesByUrl = new Map<string, Source>();
  for (const source of evidence.sources) {
    const url = canonicalUrl(source.url)!;
    if (!sourcesByUrl.has(url)) sourcesByUrl.set(url, source);
  }
  const passagesByIdentity = new Map<string, Passage>();
  for (const passage of evidence.passages) {
    const source = evidence.sources.find((candidate) => candidate.id === passage.sourceId)!;
    const url = canonicalUrl(source.url)!;
    // Preserve any canonically duplicate original sources unchanged; references
    // must still point to passages belonging to the chosen evidence source key.
    if (sourcesByUrl.get(url)!.id === passage.sourceId) passagesByIdentity.set(passageIdentity(url, passage), passage);
  }
  for (const group of [...groups].reverse()) {
    for (const candidate of group.supports) {
      if (!candidate.source || !candidate.passages.length) continue;
      const url = canonicalUrl(candidate.source.url)!;
      const existingSource = sourcesByUrl.get(url);
      const source = existingSource ?? { ...candidate.source, id: unusedKey("s", url, sourceKeys) };
      const trialKeys = new Set(passageKeys);
      const additions = new Map<string, Passage>();
      const retainedIds = new Set<string>();
      for (const passage of candidate.passages) {
        const identity = passageIdentity(url, passage);
        const retained = passagesByIdentity.get(identity) ?? additions.get(identity);
        if (retained) { retainedIds.add(retained.id); continue; }
        const added = { ...passage, id: unusedKey("p", identity, trialKeys), sourceId: source.id };
        additions.set(identity, added); trialKeys.add(added.id); retainedIds.add(added.id);
      }
      const trial = { sources: existingSource ? evidence.sources : [...evidence.sources, source],
        passages: [...evidence.passages, ...additions.values()] };
      // Retain each source version atomically. If it cannot fit, its displayed
      // identity survives with an explicit unavailable mapping, never a nearby
      // source's text or a later same-URL retrieval substituted as support.
      if (trial.sources.length > 16 || trial.passages.length > 48 || size(trial) > MAX_EVIDENCE_BYTES) continue;
      if (!existingSource) { evidence.sources.push(source); sourceKeys.add(source.id); sourcesByUrl.set(url, source); }
      for (const [identity, passage] of additions) {
        evidence.passages.push(passage); passageKeys.add(passage.id); passagesByIdentity.set(identity, passage);
      }
      candidate.reference.evidenceSourceKey = source.id;
      candidate.reference.passageIds = [...retainedIds];
    }
  }
  const previousMessages = groups.flatMap((group) => group.messages);
  assertReaderFirstPreviousMessages(previousMessages, evidence);
  return { evidence, previousMessages };
}
