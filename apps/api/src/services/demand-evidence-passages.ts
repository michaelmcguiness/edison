import { createHash } from "node:crypto";
import type { OnDemandEvidence, OnDemandResearchOutput } from "@edison/ai";
import { normalizeEvidencePassage, type retrieveEvidencePage } from "./evidence-retrieval";

type Range = { start: number; end: number };
type Candidate = Range & { text: string; terms: Set<string>; shingles: Set<string>; prose: number };
type QueryRole = "finding" | "payoff" | "qualification";
const STOP_WORDS = new Set("about above after again against also among another because been before being below between both could does doing during each from further have having here itself more most other ours over same should some such than that their them then there these they this those through under until very what when where which while whom with would your source paper study authors reports report presents describes explains".split(" "));
const MAX_WINDOWS = 3;
const MAX_WINDOW_CHARACTERS = 2_200;
const TOTAL_TEXT_BYTES = 28_000;

function terms(value: string): string[] {
  return [...new Set((value.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
    .filter((word) => !STOP_WORDS.has(word))
    .map((word) => word.length > 5 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))];
}

function shingles(value: string): Set<string> {
  const words = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.slice(4).map((_, index) => words.slice(index, index + 5).join(" ")));
}

function duplicate(a: Candidate, b: Candidate): boolean {
  if (a.start < b.end && b.start < a.end) return true;
  const minimum = Math.min(a.shingles.size, b.shingles.size);
  if (!minimum) return a.text === b.text;
  let shared = 0;
  for (const shingle of a.shingles) if (b.shingles.has(shingle)) shared++;
  return shared / minimum > 0.6;
}

/** The text allowance scales with ALL proposed sources, not successful fetches.
 * Leave 12 KB of the existing 40 KB packet ceiling for source/locator metadata.
 * Unusually large metadata still fails the caller's whole-packet check; it is
 * never silently removed to make the selected passages fit. */
export function demandPassageBudget(sourceCount: number): { bytes: number; windows: number } {
  const count = Math.max(1, Math.min(16, sourceCount));
  const bytes = Math.min(MAX_WINDOWS * MAX_WINDOW_CHARACTERS, Math.floor(TOTAL_TEXT_BYTES / count));
  return { bytes, windows: Math.min(MAX_WINDOWS, Math.max(1, Math.floor(bytes / 1_600))) };
}

/** Select discovery-guided context, not a factual-support verdict. Every emitted
 * character is a slice of independently fetched, normalized page text. Model
 * excerpts/idea promises supply search terms only, never replacement evidence.
 * The separately persisted idea/article checks must reject unsupported claims. */
export function actualDemandPassages(
  source: OnDemandResearchOutput["sources"][number],
  page: Awaited<ReturnType<typeof retrieveEvidencePage>>,
  research: OnDemandResearchOutput,
): OnDemandEvidence["passages"] {
  const actual = normalizeEvidencePassage(page.text);
  if (!actual.length) return [];
  const leads = research.passages.filter((passage) => passage.sourceId === source.id);
  const leadIds = new Set(leads.map((lead) => lead.id));
  const ideas = research.ideas.filter((idea) => idea.passageIds.some((id) => leadIds.has(id)));
  // Qualifications are separate search facets: a long headline/deck must not
  // truncate the limiting context from the tail of one combined query.
  const findingQueries = leads.map((lead) => terms(lead.text).slice(0, 64));
  const payoffQueries = ideas.map((idea) => terms([idea.headline, idea.deck, idea.readerQuestion,
    idea.payoff, idea.advanceBeyondPrevious].join(" ")).slice(0, 64));
  const qualificationQueries = ideas.flatMap((idea) => idea.qualifications.map((value) => terms(value).slice(0, 64)));
  const queries = [...findingQueries, ...payoffQueries, ...qualificationQueries];
  if (!queries.length) queries.push(terms(source.title).slice(0, 64));
  const budget = demandPassageBudget(research.sources.length);
  const windowCharacters = Math.min(MAX_WINDOW_CHARACTERS, Math.floor(budget.bytes / budget.windows));
  const candidates: Candidate[] = [];
  const starts = new Set<number>();

  function add(position: number) {
    let start = Math.max(0, Math.min(actual.length - windowCharacters, position));
    // Prefer the next sentence boundary near the proposed start. This avoids
    // beginning in a navigation label or halfway through a contextual clause.
    const boundary = /[.!?] (?=[\p{Lu}\p{N}])/u.exec(actual.slice(start, start + 180));
    if (start > 0 && boundary) start += boundary.index + 2;
    else if (start > 0) {
      // If the next sentence is distant, keep the preceding complete start
      // rather than inventing an orphan prefix in the middle of a word.
      const lookbackStart = Math.max(0, start - 180);
      const prior = [...actual.slice(lookbackStart, start).matchAll(/[.!?] (?=[\p{Lu}\p{N}])/gu)].at(-1);
      if (prior) start = lookbackStart + prior.index! + 2;
      else return;
    }
    if (starts.has(start)) return;
    starts.add(start);
    let end = Math.min(actual.length, start + windowCharacters);
    // UTF-8 and JSON escaping count toward the allowance, not JS string length.
    while (end > start && Buffer.byteLength(JSON.stringify(actual.slice(start, end)), "utf8") - 2 > windowCharacters) {
      end -= Math.max(1, Math.ceil((end - start) / 16));
    }
    // Do not split a surrogate pair or preserve a clipped final sentence when
    // a nearby complete sentence is available. Offsets still address actual.
    if (end < actual.length && /[\uD800-\uDBFF]/.test(actual[end - 1] ?? "")) end--;
    const tail = actual.slice(Math.max(start, end - 350), end);
    const endings = [...tail.matchAll(/[.!?](?=\s|$)/g)];
    if (end < actual.length && endings.length) end = Math.max(start, end - 350) + endings.at(-1)!.index! + 1;
    const text = actual.slice(start, end);
    if (!text.length) return;
    const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
    // Distinct-term coverage cannot by itself distinguish a repeated menu from
    // prose. Sentence density and vocabulary diversity break that ambiguity.
    const sentences = (text.match(/[.!?](?=\s|$)/g) ?? []).length;
    const diversity = new Set(words.map((word) => word.toLowerCase())).size / Math.max(1, words.length);
    const prose = Math.min(1, sentences / Math.max(3, text.length / 220)) * Math.min(1, diversity / 0.4);
    candidates.push({ start, end, text, terms: new Set(terms(text)), shingles: shingles(text), prose });
  }

  // Scan the WHOLE page rather than spending a fixed occurrence budget on a
  // repeated header/abstract. At most 2,049 grid windows plus 48 exact anchors.
  const stride = Math.max(400, Math.ceil(actual.length / 2_048));
  for (let at = 0; at < actual.length; at += stride) add(at);
  for (const lead of leads) {
    const normalized = normalizeEvidencePassage(lead.text);
    if (normalized.length < 40 || normalized.length > 4_000) continue;
    const at = actual.indexOf(normalized);
    if (at >= 0) add(Math.max(0, at - 300));
  }

  const resultStart = actual.indexOf(" Results ");
  const discussionStart = resultStart < 0 ? -1 : actual.indexOf(" Discussion ", resultStart + 9);
  const methodStart = discussionStart < 0 ? -1 : actual.indexOf(" Methods ", discussionStart + 12);
  const orderedStudy = resultStart >= 0 && discussionStart > resultStart && methodStart > discussionStart;
  const outcome = /\b(?:found|observed|measured|showed|demonstrated|compared|increased|decreased|improved|reduced|yielded)\b/gi;
  const limitation = /\b(?:limitations?|limited|cannot|could not|unable|insufficient|challenges?|bottlenecks?|not yet|not sufficient|not established|requires?|depends? on|remain unclear|remains unknown)\b/gi;
  const substantive = (text: string, pattern: RegExp) => text.length >= 400
    && (text.match(/[.!?](?=\s|$)/g) ?? []).length >= 2 && Boolean(text.match(pattern));
  // Flattened navigation can contain the same headings. Use section roles only
  // when their intervening text has substantive result/constraint prose; other
  // sources retain the lexical fallback instead of requiring a paper skeleton.
  const structuredStudy = orderedStudy && substantive(actual.slice(resultStart, discussionStart), outcome)
    && substantive(actual.slice(discussionStart, methodStart), limitation);
  const roleCounts = new WeakMap<Candidate, { payoff: number; qualification: number }>();
  function roleCount(candidate: Candidate, role: QueryRole): number {
    let counts = roleCounts.get(candidate);
    if (!counts) {
      counts = {
        payoff: new Set((candidate.text.match(outcome) ?? []).map((value) => value.toLowerCase())).size,
        qualification: new Set((candidate.text.match(limitation) ?? []).map((value) => value.toLowerCase())).size,
      };
      roleCounts.set(candidate, counts);
    }
    return role === "payoff" ? counts.payoff : counts.qualification;
  }
  const selected: Candidate[] = [];
  const coveredTerms = new Set<string>();
  function score(candidate: Candidate, query: string[], role: QueryRole): number {
    const matched = query.filter((term) => candidate.terms.has(term));
    const novel = matched.filter((term) => !coveredTerms.has(term)).length;
    return (matched.length + novel * 0.35) / Math.max(1, query.length) * (0.35 + candidate.prose * 0.65)
      * (role === "finding" ? 1 : 1 + Math.min(4, roleCount(candidate, role)) * 0.25);
  }
  function choose(query: string[], role: QueryRole = "finding"): Candidate | undefined {
    let best: Candidate | undefined;
    let bestScore = 0;
    for (const candidate of candidates) {
      if (selected.some((existing) => duplicate(existing, candidate))) continue;
      if (selected.length && candidate.prose < 0.2) continue;
      if (structuredStudy && role === "payoff" && (candidate.start < resultStart || candidate.start >= discussionStart)) continue;
      if (structuredStudy && role === "qualification" && (candidate.start < discussionStart || candidate.start >= methodStart)) continue;
      if (role !== "finding" && roleCount(candidate, role) === 0) continue;
      const candidateScore = score(candidate, query, role);
      if (!candidateScore) continue;
      if (candidateScore > bestScore || (candidateScore === bestScore && candidate.start < (best?.start ?? Infinity))) {
        best = candidate; bestScore = candidateScore;
      }
    }
    return best;
  }

  function chooseFamily(family: string[][], role: QueryRole): Candidate | undefined {
    let winner: Candidate | undefined;
    let winningScore = 0;
    for (const query of family) {
      const candidate = choose(query, role);
      if (!candidate) continue;
      const uncovered = query.filter((term) => !coveredTerms.has(term)).length / Math.max(1, query.length);
      const familyScore = uncovered * score(candidate, query, role);
      if (familyScore > winningScore || (familyScore === winningScore && candidate.start < (winner?.start ?? Infinity))) {
        winner = candidate; winningScore = familyScore;
      }
    }
    return winner;
  }
  // Reserve discovery, observed payoff and qualification opportunities before
  // repeated abstract leads can consume all slots. Within a family, prefer an
  // uncovered facet over another qualification already satisfied by the lead.
  for (const [family, role] of [[findingQueries, "finding"], [payoffQueries, "payoff"], [qualificationQueries, "qualification"]] as const) {
    // Cue words guide ranking, not eligibility: keep this facet's lexical
    // opportunity before returning unused slots to the discovery leads.
    const candidate = chooseFamily(family, role) ?? chooseFamily(family, "finding");
    if (candidate) {
      selected.push(candidate);
      for (const term of candidate.terms) coveredTerms.add(term);
    }
    if (selected.length >= budget.windows) break;
  }
  // Missing role cues are not evidence insufficiency by themselves. Fill any
  // unused slots with the original lexical search, including separate mechanism
  // leads and sources that are not structured research papers.
  for (const query of queries) {
    if (selected.length >= budget.windows) break;
    const candidate = choose(query);
    if (candidate) {
      selected.push(candidate);
      for (const term of candidate.terms) coveredTerms.add(term);
    }
  }
  // With no meaningful lexical match retain one honest actual-page context.
  // The downstream checker can withhold it; never substitute a model quote.
  if (!selected.length && candidates.length) selected.push(candidates[0]);
  // Sentence alignment often leaves part of the source allowance unused. Pool
  // that remainder to finish the immediately following contextual sentence,
  // rather than losing (for example) a definition just beyond a window edge.
  // This adds at most 600 actual characters per range, never overlaps another
  // selected range, and never exceeds the same per-source JSON-byte allowance.
  let remaining = budget.bytes - selected.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.text), "utf8") - 2, 0);
  const queryTerms = new Set(queries.flat());
  const continuations = selected.flatMap((candidate) => {
    const continuation = actual.slice(candidate.end, candidate.end + 600);
    const boundary = /[.!?](?=\s|$)/.exec(continuation);
    if (!boundary) return [];
    const end = candidate.end + boundary.index + 1;
    if (selected.some((other) => other !== candidate && candidate.start < other.end && end > other.start)) return [];
    const text = actual.slice(candidate.start, end);
    const extra = Buffer.byteLength(JSON.stringify(text), "utf8") - Buffer.byteLength(JSON.stringify(candidate.text), "utf8");
    const addedTerms = terms(actual.slice(candidate.end, end));
    const relevance = addedTerms.filter((term) => queryTerms.has(term)).length / Math.max(1, addedTerms.length);
    return [{ candidate, end, text, extra, relevance }];
  }).sort((a, b) => b.relevance - a.relevance || a.candidate.start - b.candidate.start);
  for (const { candidate, end, text, extra } of continuations) {
    if (extra > remaining) continue;
    candidate.end = end; candidate.text = text; remaining -= extra;
  }
  return selected.sort((a, b) => a.start - b.start).map(({ start, end, text }) => ({
    id: `p-${createHash("sha256").update(`${source.id}:${page.url}:${start}:${end}:${text}`).digest("hex").slice(0, 28)}`,
    sourceId: source.id, text,
    locator: `Retrieved normalized page text, characters ${start + 1}–${end}`,
    provenance: "retrieved" as const, retrievedAt: page.retrievedAt,
  }));
}
