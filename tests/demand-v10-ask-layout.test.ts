import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/demand.css", import.meta.url), "utf8");

test("wide compact Ask uses the article gutter without changing the reading measure", () => {
  const rule = css.match(/@media \(min-width: (\d+)px\)\s*\{\s*\/\*[^]*?\*\/\s*\.demand-ask-mini\s*\{\s*right: (\d+)px; width: min\((\d+)px, calc\(\(100vw - (\d+)px\) \/ 2 - (\d+)px\)\);\s*\}/);
  assert.ok(rule, "the wide layout must be scoped to compact Ask, not all contextual panels");
  const [breakpoint, right, maximum, measure, clearance] = rule.slice(1).map(Number) as [number, number, number, number, number];
  const article = css.match(/\.demand-article\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(article, new RegExp(`max-width: ${measure}px;`));
  assert.match(article, /margin: 0 auto;/);
  assert.equal(breakpoint, 1360);
  for (const viewport of [1360, 1440, 1546, 1920]) {
    const panelWidth = Math.min(maximum, (viewport - measure) / 2 - clearance);
    const panelLeft = viewport - right - panelWidth;
    const articleRight = (viewport + measure) / 2;
    assert.ok(panelWidth >= 300 && panelWidth <= 400, `usable compact width at ${viewport}`);
    assert.ok(panelLeft - articleRight >= 24, `no prose overlap at ${viewport}`);
    assert.ok(panelLeft - articleRight - 17 / 2 >= 15, "a classic scrollbar still leaves separation");
    assert.ok(panelLeft + panelWidth <= viewport - 24, "the panel remains inside the viewport");
  }
});

test("phone, tablet and zoom fallback retain the existing bounded compact panel", () => {
  assert.match(css, /\.demand-ask-mini \{ width: 400px; padding: 19px; \}/);
  assert.match(css, /\.demand-floating-panel \{[^}]*max-width: calc\(100vw - 36px\);/);
  assert.match(css, /@media \(max-width: 600px\) \{[^]*?\.demand-floating-panel \{ right: 18px;/);
  for (const viewport of [320, 390, 760, 1024, 1359]) assert.ok(viewport < 1360, "gutter rule does not change the narrow fallback");
});

test("textarea focus uses one visible rounded composer ring without hiding button focus", () => {
  assert.match(css, /\.demand-question-composer \{[^}]*border-radius: 24px;/);
  assert.match(css, /\.demand-question-composer:has\(textarea:focus-visible\) \{ outline: 2px solid #1d70c9; outline-offset: 3px; \}/);
  assert.match(css, /\.demand-floating-panel \.demand-question-composer textarea:focus-visible,\s*\.demand-conversation-page \.demand-question-composer textarea:focus-visible \{ outline: 0 !important; \}/);
  assert.match(css, /\.demand-floating-panel :is\(button,input,textarea,summary\):focus-visible,[^}]+outline: 2px solid #1d70c9 !important;/);
  assert.match(css, /\.demand-conversation-page :is\(button,textarea,a\):focus-visible \{ outline: 2px solid #1d70c9 !important;/);
  assert.doesNotMatch(css, /\.demand-question-composer (?:button|\*|:is\(button[^)]*\)):focus-visible\s*\{\s*outline: 0/);
});
