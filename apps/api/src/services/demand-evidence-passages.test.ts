import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { OnDemandResearchOutput } from "@edison/ai";
import { actualDemandPassages, demandPassageBudget, selectDemandEvidencePassages } from "./demand-evidence-passages";
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

test("answer and draft queries retrieve real context without ideas or invented passage identities", () => {
  const text = abstract.repeat(2) + spacer.repeat(30) + mechanism.repeat(2) + spacer.repeat(30) + tradeoff.repeat(2);
  const result = selectDemandEvidencePassages(source, page(text), {
    sources: [source], passages: [{ sourceId: source.id, text: abstract }],
    queries: ["Why do overlapping plates on a guided track change thermal expansion and compression?"],
    qualifications: ["The comparison held initial load and span geometry equal; maintenance burden increased."],
  });
  const retained = result.map((item) => item.text).join(" ");
  assert.match(retained, /overlapping plates can move along a guided track/);
  assert.match(retained, /held initial load and span geometry equal/);
  assertExactBoundedPassages(text, result);
  assert.ok(result.every((item) => item.provenance === "retrieved" && item.retrievedAt === page(text).retrievedAt));
});

test("generic targets preserve the legacy selector result exactly and ignore another source's leads", () => {
  const input = research([abstract, mechanism], "Compare support compression and maintenance burden.");
  const text = abstract + spacer.repeat(30) + mechanism + spacer.repeat(30) + tradeoff;
  const legacy = actualDemandPassages(source, page(text), input);
  const generic = selectDemandEvidencePassages(source, page(text), {
    sources: input.sources, passages: [...input.passages, { sourceId: "another-source", text: "Unretrieved invented fact about violet planets." }],
    queries: input.ideas.map((idea) => [idea.headline, idea.deck, idea.readerQuestion, idea.payoff, idea.advanceBeyondPrevious].join(" ")),
    qualifications: input.ideas.flatMap((idea) => idea.qualifications),
  });
  assert.deepEqual(generic, legacy);
});

function assertExactBoundedPassages(text: string, result: ReturnType<typeof actualDemandPassages>) {
  assert.ok(result.length <= 3);
  assert.ok(result.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.text)) - 2, 0) <= 6_600);
  const normalized = normalizeEvidencePassage(text);
  for (const item of result) {
    const positions = /characters (\d+)–(\d+)$/.exec(item.locator)!;
    assert.equal(item.text, normalized.slice(Number(positions[1]) - 1, Number(positions[2])));
  }
}

for (const limit of [
  "Chloride corrosion caused seal embrittlement in the durability trial. The pump cannot operate safely with saltwater because its seals became brittle and leaked, a limitation not resolved by changing the temperature settings.",
  "The durability trial did not test saline exposure. Chloride corrosion and seal embrittlement were outside the experimental conditions, so the observations cover clean freshwater operation only.",
]) {
  test(`long idea copy and distinct abstract leads retain results and ${limit.startsWith("The durability") ? "a qualification without standard cues" : "an uncovered qualification"}`, () => {
    const firstLead = "A copper pipe pump moves fluid through a pressure valve. The prototype uses temperature control to regulate flow across its chamber, and the abstract describes the overall mechanical performance.";
    const secondLead = "Pressure valves regulate flow through narrow channels inside an adjustable housing. Control handles set the target temperature, while copper pipes carry fluid between the inlet and the outlet.";
    const setup = "The proposed pump comparison examines temperature control and chamber flow under steady pressure. The design connects a pressure valve and copper pipes to an adjustable housing, with handles governing the target settings.";
    const observed = "We measured chamber flow and found that the copper pipe pump reduced pressure oscillation compared with the fixed valve. The experiment used equal fluid volumes and matching temperature settings, and the result held across three tested control settings.";
    const text = firstLead.repeat(3) + spacer.repeat(25) + secondLead.repeat(3) + spacer.repeat(25)
      + setup.repeat(3) + spacer.repeat(25) + " Results " + observed.repeat(3) + spacer.repeat(25)
      + " Discussion " + limit.repeat(3) + spacer.repeat(25) + " Methods The apparatus used calibrated pressure gauges.";
    const input = research([firstLead, secondLead], "Compare pump temperature control, chamber flow and pressure valve performance.");
    // These discovery terms deliberately fill the old 64-term combined query
    // before the material qualification. They are never copied into evidence.
    input.ideas[0].deck += " " + Array.from({ length: 80 }, (_, index) => `archivefacet${index}`).join(" ");
    input.ideas[0].qualifications = [
      "The prototype uses a copper pipe pump and a pressure valve to control chamber flow.",
      "Chloride corrosion and seal embrittlement prevent safe saltwater operation.",
    ];
    const result = actualDemandPassages(source, page(text), input);
    const retained = result.map((item) => item.text).join(" ");
    assert.match(retained, /We measured chamber flow and found/);
    assert.ok(retained.includes(limit));
    assert.doesNotMatch(retained, /archivefacet/);
    assertExactBoundedPassages(text, result);
  });
}

for (const navigation of ["", "Navigation Results Discussion Methods. "]) {
  test(`non-paper evidence keeps outcomes and limits${navigation ? " despite misleading navigation headings" : " without section headings"}`, () => {
    const finding = "The harbour ledger records merchants who paid customs fees. Surviving entries name ships, cargo categories, and dates, making the ledger useful for reconstructing registered trade routes.";
    const observed = "Archivists compared surviving ledgers and found repeated voyages connecting three ports. The recorded customs payments demonstrate registered shipping activity on those routes.";
    const limit = "Missing volumes and unregistered cargo limit the historical reconstruction. The archive cannot establish the total quantity of trade, and the surviving records omit smuggling and informal exchange.";
    const text = navigation + finding.repeat(4) + spacer.repeat(25) + observed.repeat(4) + spacer.repeat(25) + limit.repeat(4) + spacer.repeat(25);
    const input = research([finding], "Explain what the harbour ledger reveals about registered voyages and recorded trade routes.");
    input.ideas[0].qualifications = ["The evidence consists of surviving customs ledgers.", "Missing volumes and unregistered cargo prevent an estimate of total trade."];
    const result = actualDemandPassages(source, page(text), input);
    const retained = result.map((item) => item.text).join(" ");
    assert.match(retained, /found repeated voyages connecting three ports/);
    assert.match(retained, /cannot establish the total quantity of trade/);
    assertExactBoundedPassages(text, result);
  });
}

test("ordinary explanatory sources do not require outcome or limitation cue words", () => {
  const finding = "A potter shapes a bowl by centering clay on a wheel. Water lubricates the surface, and steady hand pressure keeps the wall thickness even during shaping.";
  const explanation = "The rim stays level when the hands travel slowly together. Turning the wheel at a steady speed keeps the bowl symmetrical through the final shaping pass.";
  const qualification = "Clay containing coarse grit needs a wider rim. A thin rim made from coarse clay has a different texture, while smooth porcelain permits finer edges.";
  const text = finding.repeat(4) + spacer.repeat(25) + explanation.repeat(4) + spacer.repeat(25) + qualification.repeat(4) + spacer.repeat(25);
  const input = research([finding], "Explain how coordinated hands and wheel speed shape an even bowl.");
  input.ideas[0].qualifications = ["Clay texture changes the appropriate rim thickness."];
  const result = actualDemandPassages(source, page(text), input);
  const retained = result.map((item) => item.text).join(" ");
  assert.match(retained, /The rim stays level when the hands travel slowly together/);
  assert.match(retained, /Clay containing coarse grit needs a wider rim/);
  assertExactBoundedPassages(text, result);
});

test("grid candidates with a distant next sentence retain a complete nearby preceding start", () => {
  const longSentence = "Using repeated measurements from independently calibrated gauges, the researchers observed "
    + "pressure and temperature variation across the adjustable chamber during each controlled comparison, ".repeat(3)
    + "and measured the complete response before ending the experiment.";
  const text = abstract + spacer.repeat(25) + longSentence + mechanism + spacer.repeat(25) + tradeoff;
  const result = actualDemandPassages(source, page(text), research([
    "Repeated measurements from independently calibrated gauges observed pressure and temperature variation across the adjustable chamber.",
  ]));
  const normalized = normalizeEvidencePassage(text);
  assert.ok(result.some((item) => item.text.includes("Using repeated measurements from independently calibrated gauges")));
  for (const item of result) {
    const start = Number(/characters (\d+)–/.exec(item.locator)![1]) - 1;
    assert.ok(start === 0 || /[.!?] $/.test(normalized.slice(0, start)), `Orphan passage start: ${item.text.slice(0, 60)}`);
  }
  assertExactBoundedPassages(text, result);
});
