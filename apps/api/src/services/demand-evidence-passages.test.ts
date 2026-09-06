import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { OnDemandResearchOutput } from "@edison/ai";
import { actualDemandPassages, demandPassageBudget } from "./demand-evidence-passages";
import { normalizeEvidencePassage } from "./evidence-retrieval";

// Constructed generic evidence only; no downloaded publisher text is committed.
const source = { id: "source", url: "https://example.org/paper", title: "Constructed source", publisher: "example.org", publishedDate: null, datePrecision: "unknown" as const };
function research(leads: string[], ideaText?: string, sourceCount = 1): OnDemandResearchOutput {
  return {
    sources: [source, ...Array.from({ length: sourceCount - 1 }, (_, index) => ({ ...source, id: `other-${index}`, url: `https://example.org/${index}` }))],
    passages: leads.map((text, index) => ({ id: `lead-${index}`, sourceId: source.id, text, locator: "Unverified discovery locator" })),
    ideas: ideaText ? [{ key: "idea", headline: ideaText, deck: ideaText, readerQuestion: ideaText, payoff: ideaText,
      advanceBeyondPrevious: ideaText, qualifications: [], passageIds: leads.map((_, index) => `lead-${index}`) }] : [],
    insufficiencyReason: null,
  };
}
function page(text: string) {
  return { text, url: source.url, title: source.title, retrievedAt: "2026-09-06T12:00:00.000Z" };
}
const spacer = "A separate archival note records the names of curators and the catalogue dates. It does not describe the experiment or make a prediction. ";
const abstract = "The reversible bridge assembly supports repeated adjustment of span geometry. The demonstration compared rigid joints with sliding joints. Measurements were conducted in a laboratory, and the summary describes overall performance rather than field certification. ";
const mechanism = "Thermal expansion increases the length of steel members. Sliding joints accommodate that expansion because their overlapping plates can move along a guided track. Without that movement, restrained members transfer additional compression into the supports. The track requires regular cleaning so debris does not jam the mechanism. ";
const tradeoff = "The comparison held initial load and span geometry equal across both structures. The benefit of sliding joints was reduced support compression, but the maintenance burden increased. These observations establish a tradeoff in the tested assemblies, not a universal superiority claim. ";

test("separate discovery leads retain abstract, mechanism and promised comparison context", () => {
  const text = abstract.repeat(2) + spacer.repeat(30) + mechanism.repeat(2) + spacer.repeat(30) + tradeoff.repeat(2);
  const result = actualDemandPassages(source, page(text), research([
    "Reversible bridge assembly uses sliding joints for repeated adjustment of span geometry in laboratory demonstrations.",
    "Thermal expansion causes compression in restrained steel members; sliding overlapping plates move along a guided track.",
  ], "Compare the maintenance burden and support compression at equal initial load and span geometry."));
  assert.equal(result.length, 3);
  const retained = result.map((item) => item.text).join(" ");
  assert.match(retained, /demonstration compared rigid joints/);
  assert.match(retained, /overlapping plates can move along a guided track/);
  assert.match(retained, /held initial load and span geometry equal/);
});

test("repeated menu terms do not exhaust candidates before relevant body prose", () => {
  const menu = "Thermal expansion steel members sliding joints compression track ".repeat(300);
  const result = actualDemandPassages(source, page(menu + spacer.repeat(25) + mechanism.repeat(2)), research([
    "Thermal expansion in steel members and compression in restrained supports can be relieved by sliding joints along a track.",
  ]));
  assert.match(result[0].text, /overlapping plates can move along a guided track/);
});

test("a later idea query cannot add a weak navigation window after useful body evidence", () => {
  const text = "NAVIGATION: Thermal expansion and maintenance. " + "General information. ".repeat(180) + mechanism;
  const result = actualDemandPassages(source, page(text), research([
    "Thermal expansion in steel members and compression in restrained supports can be relieved by sliding joints along a track.",
  ], "Understand thermal expansion and maintenance."));
  assert.ok(result.every((item) => item.text.includes("overlapping plates")));
  assert.ok(result.every((item) => !item.text.includes("NAVIGATION")));
});

test("a contextual definition at a nominal window boundary is retained whole within the shared budget", () => {
  const definition = "The drift threshold means the point when measured displacement reaches half the permitted travel, rather than the instant when the device ceases working.";
  const text = abstract + spacer.repeat(28) + mechanism.repeat(6) + definition + spacer.repeat(28) + tradeoff;
  const result = actualDemandPassages(source, page(text), research([
    "Reversible bridge assembly with sliding joints adjusts span geometry.",
    "The sliding joint track responds to thermal expansion and compressive forces; the drift threshold measures displacement and permitted travel.",
  ], "Compare the maintenance burden at equal initial load and span geometry."));
  assert.ok(result.some((item) => item.text.includes(definition)));
  assert.ok(result.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.text)) - 2, 0) <= 6_600);
});

test("an exact abstract match does not suppress a separate mechanism lead", () => {
  const result = actualDemandPassages(source, page(abstract + spacer.repeat(30) + mechanism), research([
    abstract,
    "Thermal expansion and overlapping plates on a guided track alter compression in restrained steel members.",
  ]));
  assert.equal(result.length, 2);
  assert.ok(result.some((item) => item.text.includes("overlapping plates")));
});

test("repeated abstracts at distant offsets are not separate independent passages", () => {
  const result = actualDemandPassages(source, page(abstract.repeat(12) + spacer.repeat(35) + abstract.repeat(12) + spacer.repeat(35) + mechanism.repeat(8)), research([
    abstract,
    abstract,
    "Thermal expansion of steel members increases compression without sliding joints moving along the track.",
  ]));
  assert.ok(result.some((item) => item.text.includes("overlapping plates")));
  for (let index = 1; index < result.length; index++) {
    assert.notEqual(result[index].text, result[index - 1].text);
  }
  assert.ok(result.filter((item) => item.text.includes("reversible bridge assembly")).length <= 1);
});

test("unmatched discovery text is never copied or given retrieved provenance", () => {
  const unsupported = "The undiscovered violet planet has exactly seventeen artificial moons and a secret ocean.";
  const result = actualDemandPassages(source, page(mechanism), research([unsupported]));
  assert.equal(result.length, 1);
  assert.ok(!result[0].text.includes("violet planet"));
  assert.equal(result[0].text, normalizeEvidencePassage(mechanism));
  assert.equal(result[0].provenance, "retrieved");
});

test("every locator and stable hash address the actual normalized retrieved bytes", () => {
  const input = page("  “Constructed”\n\n" + abstract + spacer.repeat(25) + mechanism);
  const output = actualDemandPassages(source, input, research([abstract, mechanism]));
  const normalized = normalizeEvidencePassage(input.text);
  for (const item of output) {
    const locator = /characters (\d+)–(\d+)$/.exec(item.locator)!;
    const start = Number(locator[1]) - 1;
    const end = Number(locator[2]);
    assert.equal(item.text, normalized.slice(start, end));
    assert.equal(item.id, `p-${createHash("sha256").update(`${source.id}:${input.url}:${start}:${end}:${item.text}`).digest("hex").slice(0, 28)}`);
    assert.equal(item.retrievedAt, input.retrievedAt);
  }
  assert.deepEqual(output, actualDemandPassages(source, input, research([abstract, mechanism])));
});

test("selected ranges never overlap even when model leads do", () => {
  const result = actualDemandPassages(source, page(abstract + mechanism + spacer.repeat(25)), research([
    abstract + mechanism.slice(0, 100), mechanism, mechanism.slice(50),
  ]));
  const ranges = result.map((item) => /characters (\d+)–(\d+)$/.exec(item.locator)!.slice(1).map(Number));
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] > ranges[i - 1][1]);
});

test("sixteen sources receive a bounded allowance instead of 48 large windows", () => {
  const input = research([abstract, mechanism], "Compare support compression and maintenance burden.", 16);
  const packets = input.sources.map((entry) => actualDemandPassages(entry, page((abstract + mechanism + tradeoff).repeat(20)), {
    ...input, passages: input.passages.map((lead) => ({ ...lead, sourceId: entry.id })),
  }));
  const packet = { sources: input.sources, passages: packets.flat() };
  assert.ok(packets.every((items) => items.length <= 1));
  assert.ok(Buffer.byteLength(JSON.stringify(packet)) < 40_000);
});

test("UTF-8 characters and JSON escapes count toward the selection allowance", () => {
  const input = research(["界界界界 " + mechanism], undefined, 16);
  const result = actualDemandPassages(source, page(("界界界界 \\\" "+ mechanism).repeat(80)), input);
  const textBytes = result.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.text)) - 2, 0);
  assert.ok(textBytes <= demandPassageBudget(16).bytes);
  assert.ok(result.every((item) => !/[\uD800-\uDBFF]$/.test(item.text)));
});

test("large pages and many distinct leads remain deterministic and bounded", () => {
  const input = research(Array.from({ length: 48 }, (_, index) => `Constructed archival ${index} ${mechanism}`));
  const result = actualDemandPassages(source, page(spacer.repeat(3_000) + mechanism), input);
  assert.ok(result.length <= 3);
  assert.ok(result.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.text)) - 2, 0) <= 6_600);
  assert.ok(result.some((item) => item.text.includes("overlapping plates")));
});

test("empty fetched text never becomes evidence", () => {
  assert.deepEqual(actualDemandPassages(source, page("  "), research([mechanism])), []);
});
