// Constructed sensor contrasts, not captured reading or provider judgments.
// These reusable expected labels can seed a later authorized semantic comparison;
// the injected regression tests only prove contract and orchestration behavior.
const overbroad = "Comparing a room sensor with a trusted reference thermometer at one steady temperature proves the sensor is accurate in every setting.";
export const sensorExplanation = "Compare the room sensor with a trusted reference thermometer at the same steady temperature. A difference shows disagreement under those conditions, so the comparison can reveal an offset. One matching reading does not establish accuracy at other temperatures or prove the sensor will keep working later.";

export const readerFirstRepairContrasts = {
  missingHow: {
    original: overbroad,
    repaired: "A comparison can reveal disagreement under the conditions tested. Agreement at one point does not establish accuracy at every temperature.",
    expected: "withhold", accuracyPassed: true, verificationPassed: true, promiseFulfilled: false,
    kind: "payoff", reason: "The limit is accurate, but the explanation never says what is compared or how the reader would obtain the result.",
    remedy: "Connect the sensor reading to a reference reading at the same steady temperature, while keeping the test's limits.",
  },
  missingResultMeaning: {
    original: overbroad,
    repaired: "Place the room sensor and a trusted reference thermometer together at a steady temperature, wait for stable readings, and record both numbers.",
    expected: "withhold", accuracyPassed: true, verificationPassed: true, promiseFulfilled: false,
    kind: "payoff", reason: "A procedure alone does not explain what disagreement helps establish, why it matters, or what one comparison cannot establish.",
    remedy: "Explain how the comparison can reveal an offset under these conditions without proving universal accuracy or future reliability.",
  },
  scopedExplanation: {
    original: overbroad, repaired: sensorExplanation,
    expected: "accept", accuracyPassed: true, verificationPassed: true, promiseFulfilled: true,
    kind: null, reason: "The repaired explanation keeps the causal comparison and narrows the conclusion to the tested conditions.",
    remedy: null,
  },
  unsupportedCurrentUse: {
    original: "This newly released sensor was approved this month for hospital medication storage, and a single comparison establishes that it is suitable for that use.",
    repaired: `${sensorExplanation} This newly released sensor was approved this month for hospital medication storage.`,
    expected: "withhold", accuracyPassed: true, verificationPassed: false, promiseFulfilled: true,
    kind: "verification_required", reason: "The stable comparison explanation cannot establish this current, consequential approval claim; no applicable approval record is retained.",
    remedy: "Verify the particular approval with an applicable current source, or remove the unsupported claim without losing the stable explanation.",
  },
  wrongDisplayedSource: {
    original: sensorExplanation, repaired: sensorExplanation,
    expected: "withhold", accuracyPassed: true, verificationPassed: true, promiseFulfilled: true,
    kind: "citation", reason: "The displayed packaging source does not support this explanation. The separate retained comparison source does; source membership alone is not support.",
    remedy: "Cite the retained comparison source at this paragraph and preserve the useful explanation.",
  },
  repairedDisplayedSource: {
    original: sensorExplanation, repaired: sensorExplanation,
    expected: "accept", accuracyPassed: true, verificationPassed: true, promiseFulfilled: true,
    kind: null, reason: "Only the citation changes to the retained comparison source; the supported causal explanation and limits remain intact.",
    remedy: null,
  },
} as const;
