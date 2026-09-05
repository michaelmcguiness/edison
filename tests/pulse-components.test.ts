import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { makeDemoStories } from "../lib/demo-content";
import {
  PULSE_LONGITUDE_ARTWORK,
  PULSE_SLEEP_ARTWORK,
  PulseFeed,
} from "../components/edison/pulse-feed";
import {
  PULSE_FOR_YOU_ID,
  PulseShell,
} from "../components/edison/pulse-shell";
import { ProfileView } from "../components/edison/library-profile";

const noop = () => undefined;

function renderShell(options: { showLoopNavigation?: boolean; showCurate?: boolean } = {}) {
  const properties: ComponentProps<typeof PulseShell> = {
    loops: [
      { id: "sleep", title: "Sleep" },
      { id: "history", title: "History" },
    ],
    activeLoopId: PULSE_FOR_YOU_ID,
    onSelectLoop: noop,
    onAddLoop: noop,
    onOpenHome: noop,
    onOpenLibrary: noop,
    onOpenProfile: noop,
    onOpenCurate: noop,
    children: createElement("main", null, "Reading"),
    ...options,
  };
  return renderToStaticMarkup(createElement(PulseShell, properties));
}

test("Pulse shell exposes real destinations, loop navigation and one labeled Curate action", () => {
  const html = renderShell();

  assert.match(html, /aria-label="Open Library"/);
  assert.match(html, /aria-label="Open Profile"/);
  assert.match(html, />For You</);
  assert.match(html, />Sleep</);
  assert.match(html, />History</);
  assert.match(html, />New loop</);
  assert.equal((html.match(/pulse-curate-fab/g) ?? []).length, 1);
  assert.match(html, />Curate</);
  assert.equal((html.match(/<main/g) ?? []).length, 1);
});

test("Pulse shell removes feed-only navigation and Curate outside the feed", () => {
  const html = renderShell({ showLoopNavigation: false, showCurate: false });

  assert.doesNotMatch(html, /pulse-loop-navigation/);
  assert.doesNotMatch(html, /pulse-curate-fab/);
  assert.match(html, /aria-label="Open Library"/);
  assert.match(html, /aria-label="Open Profile"/);
});

test("Pulse feed keeps an intentional no-art fallback for unmatched identities", () => {
  const [withoutArt] = makeDemoStories("2026-09-05T12:00:00.000Z");
  const html = renderToStaticMarkup(createElement(PulseFeed, {
    articles: [withoutArt],
    intro: "One readable story.",
    onOpenArticle: noop,
    onToggleSave: noop,
  }));

  assert.equal((html.match(/pulse-card--without-art/g) ?? []).length, 1);
  assert.match(html, /aria-label="Save to Library:/);
  assert.equal((html.match(/<main/g) ?? []).length, 1);
});

test("accepted artwork carries explicit image metadata for stable-ID mapping", () => {
  assert.deepEqual(PULSE_SLEEP_ARTWORK, {
    src: "/brand/pulse-loops/sleep-attention.png",
    alt: "A pillow and peach blanket beside a moonlit window.",
    captionColor: "#435a68",
    width: 1254,
    height: 1254,
  });
  assert.deepEqual(PULSE_LONGITUDE_ARTWORK, {
    src: "/brand/pulse-loops/longitude.png",
    alt: "A sailboat and an abstract marine clock.",
    captionColor: "#375d68",
    width: 1254,
    height: 1254,
  });
});

test("Profile device controls remain inside the page main landmark", () => {
  const html = renderToStaticMarkup(createElement(ProfileView, {
    dataMode: "guest",
    reader: { name: "", email: "" },
    profile: null,
    loading: false,
    error: "",
    streak: 0,
    back: noop,
    preferenceSaving: false,
    interestAction: null,
    updatePreference: async () => undefined,
    addInterest: async () => false,
    updateInterestStatus: async () => undefined,
    deleteInterest: async () => undefined,
    manageCategories: noop,
    reviewDirection: noop,
    deviceSettings: createElement("section", { className: "pulse-device-settings" }, "Device controls"),
  }));

  const mainStart = html.indexOf("<main");
  const settings = html.indexOf("pulse-device-settings");
  const mainEnd = html.indexOf("</main>");
  assert.ok(mainStart >= 0 && settings > mainStart && mainEnd > settings);
});
