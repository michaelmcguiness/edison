import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import {
  PublicationFolio,
  PublicationShell,
} from "../components/edison/publication-shell";

const noop = () => undefined;

function renderShell(showCreate?: boolean) {
  const properties: ComponentProps<typeof PublicationShell> = {
    section: "news",
    profileLabel: "Reader",
    streak: 0,
    showCreate,
    onSectionChange: noop,
    onOpenProfile: noop,
    onOpenLibrary: noop,
    onCreate: noop,
    children: createElement("main", null, "Edition content"),
  };
  return renderToStaticMarkup(createElement(PublicationShell, properties));
}

test("publication shell exposes the three exact destinations and home creation action", () => {
  const html = renderShell();
  for (const label of ["News", "Books", "Podcasts"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /aria-label="Create one article"/);
  assert.match(html, /A publication written entirely for you, every day/);
});

test("contextual creation action can be removed outside publication homes", () => {
  const html = renderShell(false);
  assert.doesNotMatch(html, /publication-create|Create one article/);
});

test("folio handles singular counts and an unavailable date without stray punctuation", () => {
  const dated = renderToStaticMarkup(createElement(PublicationFolio, {
    section: "podcasts",
    editionDate: "2026-09-04",
    personalLabel: "Edited for Reader",
    count: 1,
  }));
  assert.match(dated, /September 4, 2026/);
  assert.match(dated, /1 episode/);

  const undated = renderToStaticMarkup(createElement(PublicationFolio, {
    section: "books",
    editionDate: "unavailable",
    personalLabel: "Edited for Reader",
    count: 0,
  }));
  assert.match(undated, /0 books/);
  assert.doesNotMatch(undated, / · /);
});
