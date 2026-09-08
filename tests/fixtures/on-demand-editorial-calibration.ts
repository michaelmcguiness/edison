// Constructed contrast corpus for later editorial evaluation. Expected meanings
// are authored benchmark labels, not observed provider judgments. No semantic
// provider comparison has been run against these cases.
export const editorialCalibrationContrasts = {
  designIntent: {
    evidence: "The team designed a sensor to register light. The record does not report measured detection accuracy.",
    prose: "The sensor was designed to register light.",
    expectedMeaning: "Describes the intended function, without asserting achieved accuracy.",
    expectedVerdict: "supported",
    reason: "The retained design record explicitly states this intent.",
  },
  missingAchievement: {
    evidence: "The team designed a sensor to register light. The record does not report measured detection accuracy.",
    prose: "The sensor achieved perfect detection accuracy.",
    expectedMeaning: "Asserts an achieved measurement that the design record does not establish.",
    expectedVerdict: "missing",
    reason: "Design intent does not establish achieved perfect accuracy.",
  },
  opposedAchievement: {
    evidence: "The constructed test missed two signals.",
    prose: "The sensor detected every test signal.",
    expectedMeaning: "Asserts complete detection, opposed by the explicit missed-signal result.",
    expectedVerdict: "contradicted",
    reason: "The retained test explicitly reports missed signals.",
  },
  impreciseDefinition: {
    evidence: "The sensor converts incoming light into an electrical signal.",
    prose: "A sensor is a light-storage device.",
    expectedMeaning: "An unsupported storage definition, not a claim of achieved detection accuracy.",
    expectedVerdict: "missing",
    reason: "The conversion description does not establish light storage; clarify the definition without alleging false achieved accuracy.",
  },
  transferredOutcome: {
    evidence: "A different sensor detected every trial signal. The current sensor is described only as a design.",
    prose: "The current sensor detected every trial signal.",
    expectedMeaning: "Transfers another device's measured outcome to the current untested design.",
    expectedVerdict: "missing",
    reason: "The reported outcome belongs to a different sensor and cannot establish the current design's achieved result.",
  },
} as const;
