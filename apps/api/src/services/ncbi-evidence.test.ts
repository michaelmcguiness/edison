import assert from "node:assert/strict";
import test from "node:test";
import { MAX_NCBI_RECORD_BYTES, ncbiEvidenceTarget, parseNcbiEvidence } from "./ncbi-evidence";

// Constructed BioC records follow observed official PMC/PubMed envelopes, not
// publisher full text. These tests perform no network/provider operations.
const prose = "The sensor detected three flashes in this experiment. That measured response does not establish how well it will work in another setting.";
function record(kind: "pmc" | "pubmed" = "pmc") {
  const id = kind === "pmc" ? "PMC123" : "456";
  const titleInfons = kind === "pmc" ? { type: "front", section_type: "TITLE", "article-id_pmc": id } : { type: "title" };
  return [{ source: "NCBI", infons: {}, documents: [{ id, infons: {}, passages: [
    { infons: titleInfons as Record<string, string>, text: "How the sensor responded" },
    { infons: { type: "abstract", section_type: "ABSTRACT" } as Record<string, string>, text: prose },
  ] }] }];
}
const pmc = ncbiEvidenceTarget("https://pmc.ncbi.nlm.nih.gov/articles/PMC123/")!;
const pubmed = ncbiEvidenceTarget("https://pubmed.ncbi.nlm.nih.gov/456/")!;

test("exact recognized article identities produce only fixed official BioC JSON URLs", () => {
  assert.equal(pmc.id, "PMC123"); assert.equal(pmc.kind, "pmc");
  assert.equal(pmc.retrievalUrl, "https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/PMC123/unicode");
  assert.equal(pubmed.retrievalUrl, "https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pubmed.cgi/BioC_json/456/unicode");
  assert.equal(ncbiEvidenceTarget("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123")?.id, "PMC123");
  assert.equal(ncbiEvidenceTarget("https://www.ncbi.nlm.nih.gov/pubmed/456")?.id, "456");
  for (const value of ["https://pmc.ncbi.nlm.nih.gov.evil.org/articles/PMC123/", "http://pmc.ncbi.nlm.nih.gov/articles/PMC123/",
    "https://secret@pmc.ncbi.nlm.nih.gov/articles/PMC123/", "https://pmc.ncbi.nlm.nih.gov:8443/articles/PMC123/",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/?id=456", "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/#section",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/pdf/", "https://pubmed.ncbi.nlm.nih.gov/?term=456",
    "https://pubmed.ncbi.nlm.nih.gov/456,789/", "https://pubmed.ncbi.nlm.nih.gov/%34%35%36/",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC00123/", "https://example.org/PMC123/"]) assert.equal(ncbiEvidenceTarget(value), null, value);
});

test("PMC title, abstract, results and limitations are actual text; references, supplements and caption shells are excluded", () => {
  const payload = record(); const passages = payload[0].documents[0].passages;
  passages.push({ infons: { type: "title_1", section_type: "CONCL" }, text: "Important limitations" },
    { infons: { type: "paragraph", section_type: "CONCL" }, text: "A larger test is still needed." },
    { infons: { type: "paragraph", section_type: "RESULTS" }, text: "The result was three detected flashes." });
  for (const section of ["REF", "SUPPL", "FIG", "TABLE", "ACK_FUND"]) {
    passages.push({ infons: { type: "paragraph", section_type: section }, text: `Excluded ${section} content.` });
  }
  passages.push({ infons: { type: "footnote", section_type: "CONCL" }, text: "Excluded metadata." });
  const before = JSON.stringify(payload); const result = parseNcbiEvidence(pmc, before);
  assert.equal(result.title, "How the sensor responded"); assert.equal(result.url, pmc.sourceUrl); assert.equal(result.retrievalUrl, pmc.retrievalUrl);
  assert.ok(result.text.includes(prose)); assert.ok(result.text.includes("Important limitations\n\nA larger test is still needed."));
  assert.ok(result.text.includes("The result was three detected flashes.")); assert.equal(result.text.includes("Excluded"), false);
  assert.equal(JSON.stringify(payload), before); assert.equal("publishedDate" in result, false, "do not turn collection/version dates into publication dates");
});

test("PubMed retains the exact requested abstract identity, not an inferred PMC full-text equivalence", () => {
  const payload = record("pubmed"); payload[0].documents[0].passages.push({ infons: { type: "paragraph" }, text: "Unrequested other content." });
  const result = parseNcbiEvidence(pubmed, JSON.stringify(payload));
  assert.equal(result.url, pubmed.sourceUrl); assert.ok(result.text.includes(prose)); assert.equal(result.text.includes("Unrequested"), false);
  assert.throws(() => parseNcbiEvidence(pmc, JSON.stringify(payload)), /identity_mismatch/);
});

test("record and supplied identity metadata must agree exactly even if the title or prose seems relevant", () => {
  const other = record(); other[0].documents[0].id = "PMC999";
  assert.throws(() => parseNcbiEvidence(pmc, JSON.stringify(other)), /identity_mismatch/);
  for (const location of ["document", "title", "body"] as const) {
    const payload = record(); const document = payload[0].documents[0];
    const infons = location === "document" ? document.infons : document.passages[location === "title" ? 0 : 1].infons;
    Object.assign(infons, { "article-id_pmc": "PMC999" });
    assert.throws(() => parseNcbiEvidence(pmc, JSON.stringify(payload)), /identity_mismatch/, location);
  }
  const payload = record("pubmed"); payload[0].documents[0].passages[0].infons.pmid = "789";
  assert.throws(() => parseNcbiEvidence(pubmed, JSON.stringify(payload)), /identity_mismatch/);
});

test("a caller cannot inject another endpoint, record type or source URL into a valid target", () => {
  for (const changed of [{ ...pmc, retrievalUrl: "https://evil.org/" }, { ...pmc, id: "PMC999" },
    { ...pmc, sourceUrl: "https://example.org/articles/PMC123/" }, { ...pmc, kind: "pubmed" as const }]) {
    assert.throws(() => parseNcbiEvidence(changed, JSON.stringify(record())), /target_invalid/);
  }
});

test("challenge/error bodies, malformed collections, duplicate records and metadata-only output never become evidence", () => {
  const payload = record();
  for (const raw of ["<html>reCAPTCHA challenge</html>", '{"error":"unavailable"}', "[]", JSON.stringify([payload[0], payload[0]]),
    JSON.stringify([{ documents: [payload[0].documents[0], payload[0].documents[0]] }])]) {
    assert.throws(() => parseNcbiEvidence(pmc, raw), /content_invalid/);
  }
  payload[0].documents[0].passages.pop();
  assert.throws(() => parseNcbiEvidence(pmc, JSON.stringify(payload)), /content_unavailable/);
  const duplicateTitle = record(); duplicateTitle[0].documents[0].passages.push(duplicateTitle[0].documents[0].passages[0]);
  assert.throws(() => parseNcbiEvidence(pmc, JSON.stringify(duplicateTitle)), /content_unavailable/);
  assert.throws(() => parseNcbiEvidence(pmc, "é".repeat(MAX_NCBI_RECORD_BYTES / 2 + 1)), /too_large/);
});
