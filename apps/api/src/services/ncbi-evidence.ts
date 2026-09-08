import { z } from "zod";

// Official programmatic routes, not alternate browser pages or access-control
// workarounds. Availability and reuse terms differ by record.
// https://www.ncbi.nlm.nih.gov/research/bionlp/APIs/BioC-PMC/
// https://www.ncbi.nlm.nih.gov/research/bionlp/APIs/BioC-PubMed/
export type NcbiEvidenceTarget = {
  kind: "pmc" | "pubmed";
  id: string;
  sourceUrl: string;
  retrievalUrl: string;
};
export const MAX_NCBI_RECORD_BYTES = 2 * 1024 * 1024;

/** Recognize an exact article identity. The caller must not fall back to
 * automated PMC HTML retrieval when an NCBI content URL is unsupported. */
export function ncbiEvidenceTarget(value: string): NcbiEvidenceTarget | null {
  if (value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
  let kind: NcbiEvidenceTarget["kind"];
  let match: RegExpExecArray | null;
  if (url.hostname === "pmc.ncbi.nlm.nih.gov") {
    kind = "pmc"; match = /^\/articles\/(PMC[1-9]\d{0,11})\/?$/.exec(url.pathname);
  } else if (url.hostname === "pubmed.ncbi.nlm.nih.gov") {
    kind = "pubmed"; match = /^\/([1-9]\d{0,11})\/?$/.exec(url.pathname);
  } else if (url.hostname === "www.ncbi.nlm.nih.gov") {
    kind = "pmc"; match = /^\/pmc\/articles\/(PMC[1-9]\d{0,11})\/?$/.exec(url.pathname);
    if (!match) { kind = "pubmed"; match = /^\/pubmed\/([1-9]\d{0,11})\/?$/.exec(url.pathname); }
  } else return null;
  if (!match) return null;
  const id = match[1];
  const service = kind === "pmc" ? "pmcoa" : "pubmed";
  return { kind, id, sourceUrl: url.href,
    retrievalUrl: `https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/${service}.cgi/BioC_json/${id}/unicode` };
}

const infons = z.record(z.unknown());
const passageSchema = z.object({
  text: z.string().optional(), infons: infons.default({}),
}).passthrough();
const recordSchema = z.array(z.object({
  documents: z.array(z.object({
    id: z.string(), infons: infons.default({}), passages: z.array(passageSchema).min(1).max(4096),
  }).passthrough()).length(1),
}).passthrough()).length(1);
type Passage = z.infer<typeof passageSchema>;
const excludedSections = /^(REF|REFERENCES|BIBLIOGRAPHY|SUPPL|SUPPLEMENT|SUPPLEMENTARY|FIG|FIGURE|TABLE|FOOT|FOOTNOTE|ACK|ACK_FUND|ACKNOWLEDGMENTS|ACKNOWLEDGEMENTS|AUTH_CONT|COMP_INT|ABBR|APPENDIX|LICENSE|COPYRIGHT)$/;
function normalize(value: string) { return value.replace(/\s+/g, " ").trim(); }
function metadata(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error("evidence_ncbi_content_invalid");
  return value;
}
function verifyIdentity(values: Record<string, unknown>, target: NcbiEvidenceTarget) {
  const keys = target.kind === "pmc" ? ["article-id_pmc", "pmcid"] : ["article-id_pmid", "pmid"];
  for (const key of keys) {
    if (values[key] !== undefined && values[key] !== target.id) throw new Error("evidence_ncbi_identity_mismatch");
  }
}
function classify(passage: Passage, kind: NcbiEvidenceTarget["kind"]): "title" | "prose" | "heading" | null {
  const type = metadata(passage.infons.type).toLowerCase();
  const section = metadata(passage.infons.section_type).toUpperCase();
  if (excludedSections.test(section)) return null;
  if (kind === "pubmed") return type === "title" ? "title" : type === "abstract" ? "prose" : null;
  if (section === "TITLE" && type === "front") return "title";
  if (type === "abstract" || type === "paragraph") return "prose";
  if (/^title(?:_\d+)?$/.test(type)) return "heading";
  return null;
}

/** Pure parsing only: the caller owns TLS/DNS pinning, fixed-endpoint/no-redirect
 * transport, timeout, byte counting, status handling and serialized rate limits.
 * A title/identifier match is not a factual-support or licensing verdict. */
export function parseNcbiEvidence(target: NcbiEvidenceTarget, raw: string): {
  url: string; retrievalUrl: string; title: string; text: string;
} {
  const expected = ncbiEvidenceTarget(target.sourceUrl);
  if (!expected || (Object.keys(expected) as Array<keyof NcbiEvidenceTarget>).some((key) => target[key] !== expected[key])) {
    throw new Error("evidence_ncbi_target_invalid");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_NCBI_RECORD_BYTES) throw new Error("evidence_content_too_large");
  let parsed: z.infer<typeof recordSchema>;
  try { parsed = recordSchema.parse(JSON.parse(raw)); }
  catch { throw new Error("evidence_ncbi_content_invalid"); }
  const document = parsed[0].documents[0];
  if (document.id !== target.id) throw new Error("evidence_ncbi_identity_mismatch");
  verifyIdentity(document.infons, target);
  const titles: string[] = []; const content: string[] = []; let proseCharacters = 0;
  for (const passage of document.passages) {
    verifyIdentity(passage.infons, target);
    const type = classify(passage, target.kind);
    if (!type || !passage.text) continue;
    const text = normalize(passage.text);
    if (!text) continue;
    if (type === "title") titles.push(text);
    else { content.push(text); if (type === "prose") proseCharacters += text.length; }
  }
  if (titles.length !== 1 || proseCharacters < 100) throw new Error("evidence_content_unavailable");
  return { url: target.sourceUrl, retrievalUrl: target.retrievalUrl,
    title: titles[0].slice(0, 300), text: [titles[0], ...content].join("\n\n") };
}
