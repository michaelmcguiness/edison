import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demandArtDescriptorSchema, isDemandArtAvailable, readDemandArtDescriptor, type DemandArtDescriptor } from "../packages/contracts/src/demand-art";
import { DemandArticleArt } from "../components/edison/demand-v11/art";

const sample: DemandArtDescriptor = { version: 1, composition: "living-system", palette: "sage", variant: 0 };
const render = (descriptor: unknown) => renderToStaticMarkup(createElement(DemandArticleArt, { descriptor }));

test("only closed, bounded art choices can render; hostile and unsupported fields cannot enter SVG", () => {
  for (const descriptor of [
    undefined, null, "<svg onload=alert(1)>", [], {},
    { ...sample, version: 2 }, { ...sample, composition: "https://example.org/image.svg" },
    { ...sample, palette: "url(https://example.org/track)" },
    ...[-1, 3, 0.5, NaN, Infinity, "1"].map((variant) => ({ ...sample, variant })),
    { ...sample, svg: "<script>alert(1)</script>" }, { ...sample, onLoad: "alert(1)" },
    { ...sample, title: "This diagram proves a medical outcome" },
  ]) {
    assert.equal(demandArtDescriptorSchema.safeParse(descriptor).success, false);
    assert.equal(readDemandArtDescriptor(descriptor), null);
    assert.equal(isDemandArtAvailable(descriptor), false);
    assert.equal(render(descriptor), "", "text can render without an art placeholder or error");
  }
});

test("all supported art combinations render complete, responsive decorative vectors with local references only", () => {
  for (const composition of demandArtDescriptorSchema.shape.composition.options) {
    for (const palette of demandArtDescriptorSchema.shape.palette.options) {
      for (const variant of [0, 1, 2]) {
        const descriptor = { version: 1, composition, palette, variant };
        assert.equal(isDemandArtAvailable(descriptor), true);
        const markup = render(descriptor);
        assert.match(markup, /viewBox="0 0 1200 800"/);
        assert.match(markup, /preserveAspectRatio="xMidYMid meet"/);
        assert.match(markup, /width:100%;height:auto;aspect-ratio:3 \/ 2/);
        assert.match(markup, /aria-hidden="true" focusable="false"/);
        assert.match(markup, /<path /);
        assert.doesNotMatch(markup, /<(?:script|foreignObject|image|text|animate|iframe)\b|(?:href|onload)=|Math\.random|data:/i);
        const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
        for (const ref of markup.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.has(ref[1]), `local SVG reference ${ref[1]} resolves`);
        assert.ok(markup.length < 13_000, "bounded markup remains independent of topic/reader input");
      }
    }
  }
});

test("SSR IDs are stable across equivalent renders and unique when saved art repeats on one page", () => {
  const page = () => createElement("main", null,
    createElement(DemandArticleArt, { descriptor: sample }),
    createElement(DemandArticleArt, { descriptor: sample }),
    createElement(DemandArticleArt, { descriptor: { ...sample, composition: "built-space" } }),
  );
  const markup = renderToStaticMarkup(page());
  assert.equal(renderToStaticMarkup(page()), markup);
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const before = JSON.stringify(sample);
  render(sample);
  assert.equal(JSON.stringify(sample), before, "rendering does not change the stored descriptor");
});

test("historical or unmatched reading stays text first without substituting an unrelated composition", () => {
  for (const idea of [
    { headline: "How a runoff election works" },
    { headline: "What happened in the fourth quarter?", art: null },
    { headline: "A history of oral storytelling", art: { ...sample, composition: "unknown-future-art" } },
  ]) {
    const descriptor = "art" in idea ? idea.art : undefined;
    const markup = renderToStaticMarkup(createElement("article", null,
      createElement(DemandArticleArt, { descriptor }), createElement("h2", null, idea.headline)));
    assert.match(markup, /<h2>/);
    assert.doesNotMatch(markup, /<svg|loading|preparing/i);
  }
});
