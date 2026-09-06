import { onDemandArticleSurfaceManifest, type OnDemandCheckOutput, type OnDemandProviderRequest, type OnDemandWriterOutput, type OnDemandWriterProviderOutput } from "../../packages/ai/src/on-demand";

export function surfaceCheckFixture(draft: OnDemandWriterOutput): NonNullable<OnDemandCheckOutput["surfaceChecks"]> {
  const manifest = onDemandArticleSurfaceManifest(draft);
  return { fingerprint: manifest.fingerprint, surfaces: manifest.surfaces.map((surface) => ({
    location: surface.location, verdict: surface.kind === "heading" && !surface.claims.length ? "nonfactual" : "supported",
    passageIds: [...new Set(surface.claims.flatMap((claim) => claim.passageIds))],
    reason: "Constructed full-surface assessment, not a semantic-quality claim.",
  })) };
}

/** Test-only bridge for constructed canonical fixtures. Production deliberately
 * does not accept historical flat writer JSON as the new provider contract. */
export function writerProviderFixture(value: OnDemandWriterOutput): OnDemandWriterProviderOutput {
  const claims = (location: string) => value.claims.filter((claim) => claim.locations.includes(location))
    .map(({ text, passageIds }) => ({ text, passageIds: [...passageIds] }));
  const article = value.article;
  return {
    status: value.status, reason: value.reason,
    article: article ? {
      category: article.category, kicker: article.kicker, topic: article.topic,
      whyWritten: article.whyWritten, readingMinutes: article.readingMinutes,
      title: { text: article.title, claims: claims("title") },
      deck: { text: article.deck, claims: claims("deck") },
      summary: article.summary.map((text, index) => ({ text, claims: claims(`summary.${index}`) })),
      body: article.body.map((block, index) => {
        const local = claims(`body.${index}`);
        if (block.type === "heading") return { ...block, evidence: local.length ? { kind: "material" as const, claims: local } : { kind: "neutral" as const, claims: [] } };
        if (block.type === "quote") return { type: block.type, text: block.text, attribution: block.attribution, claims: local };
        return { type: block.type, text: block.text, claims: local };
      }),
    } : null,
  };
}

export function providerFixtureOutput(request: OnDemandProviderRequest, output: unknown): unknown {
  if ((request.stage === "write" || request.stage === "repair") && output && typeof output === "object" && "claims" in output) {
    return writerProviderFixture(output as OnDemandWriterOutput);
  }
  if (request.stage === "check" && (request.input as { mode?: string }).mode !== "article_question" && output && typeof output === "object" && "sourceMetadataPassed" in output) {
    const result = { ...output } as Record<string, unknown>;
    delete result.sourceMetadataPassed;
    const audit = (output as OnDemandCheckOutput).surfaceChecks ?? surfaceCheckFixture((request.input as { draft: OnDemandWriterOutput }).draft);
    result.surfaceChecks = { fingerprint: audit.fingerprint,
      surfaces: Object.fromEntries(audit.surfaces.map(({ location, ...checked }) => [location, checked])) };
    return result;
  }
  return output;
}
