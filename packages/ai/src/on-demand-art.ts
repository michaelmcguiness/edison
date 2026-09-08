import { readDemandArtDescriptor } from "@edison/contracts";

/** Art is optional presentation data. Quarantine only a bad art field before
 * strict text/evidence validation, preserving raw retained provider output and
 * missing historical fields. No attempt is made to repair or replace text. */
export function normalizeOnDemandIdeaArt(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output) || !("ideas" in output)
    || !Array.isArray(output.ideas) || output.ideas.length > 6) return output;
  return { ...output, ideas: output.ideas.map((idea: unknown) => {
    if (!idea || typeof idea !== "object" || Array.isArray(idea) || !Object.hasOwn(idea, "art")) return idea;
    return { ...idea, art: readDemandArtDescriptor((idea as { art: unknown }).art) };
  }) };
}
