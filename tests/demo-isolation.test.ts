import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { updateSession } from "../lib/supabase/proxy";
import { makeDemoArticle, makeDemoStories } from "../lib/demo-content";

test("demo session proxy never calls Supabase, even with configured credentials", async (context) => {
  const values = {
    EDISON_DEMO_MODE: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://auth.example.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  };
  const previous = Object.keys(values).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, values);
  const fetchMock = context.mock.method(globalThis, "fetch", () => {
    throw new Error("Demo must not call a live service");
  });

  try {
    const response = await updateSession(new NextRequest("https://demo.example.test/"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.has("set-cookie"), false);
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("demo stories do not claim fabricated sources or include public shares", () => {
  const stories = makeDemoStories("2026-09-04T12:00:00.000Z");
  assert.ok(stories.length > 0);
  for (const story of stories) {
    const article = makeDemoArticle(story, "Demo reader");
    assert.equal(story.sourceCount, 0);
    assert.deepEqual(article.sources, []);
    assert.equal(article.shareId, null);
    for (const block of article.body) {
      if (block.type !== "heading") assert.deepEqual(block.citations, []);
    }
  }
});
