import assert from "node:assert/strict";
import test from "node:test";
import { changeLocalDirection, createLocalLoop, emptyPulseWorkspace, parsePulseWorkspace, pulseWorkspaceKey } from "../lib/pulse-workspace";

const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const now = "2026-09-05T12:00:00.000Z";
test("explicit local loops retain curiosity, membership and duplicate identity without guessing expertise", () => {
  const first = createLocalLoop(emptyPulseWorkspace(), { title: "Sleep", originalCuriosity: "Sleep", publicArticleIds: [ids[2]] }, ids[0], now);
  const duplicate = createLocalLoop(first.workspace, { title: " sleep ", originalCuriosity: "Sleep", publicArticleIds: [ids[2]] }, ids[1], now);
  assert.equal(duplicate.loop.id, first.loop.id);
  assert.equal(duplicate.loop.originalCuriosity, "Sleep");
  assert.deepEqual(duplicate.loop.publicArticleIds, [ids[2]]);
  assert.equal("currentLevel" in first.loop, false);
});

test("a normalized title collision never silently discards a different curiosity", () => {
  const first = createLocalLoop(emptyPulseWorkspace(), { title: "Sleep", originalCuriosity: "Sleep", publicArticleIds: [ids[2]] }, ids[0], now);
  assert.throws(() => createLocalLoop(first.workspace, { title: " sleep ", originalCuriosity: "Why do I feel sleepy?", publicArticleIds: [] }, ids[1], now), /different question/);
  const prefix = "a".repeat(120);
  const long = createLocalLoop(emptyPulseWorkspace(), { title: prefix, originalCuriosity: `${prefix} one`, publicArticleIds: [] }, ids[0], now);
  assert.throws(() => createLocalLoop(long.workspace, { title: prefix, originalCuriosity: `${prefix} two`, publicArticleIds: [] }, ids[1], now), /different question/);
  assert.equal(first.loop.originalCuriosity, "Sleep");
  assert.deepEqual(first.loop.publicArticleIds, [ids[2]]);
});

test("local direction is revision safe, reversible and isolated from other loops", () => {
  const first = createLocalLoop(emptyPulseWorkspace(), { title: "Sleep", originalCuriosity: "Sleep", publicArticleIds: [] }, ids[0], now);
  const second = createLocalLoop(first.workspace, { title: "History", originalCuriosity: "History", publicArticleIds: [] }, ids[1], now);
  const changed = changeLocalDirection(second.workspace, ids[0], 0, "More on recovery", ids[2], now);
  assert.equal(changed.loops[1].direction, "");
  assert.throws(() => changeLocalDirection(changed, ids[0], 0, "stale", ids[2], now), /another tab/);
  const undone = changeLocalDirection(changed, ids[0], 1, "", ids[1], now, ids[2]);
  assert.equal(undone.loops[0].direction, "");
  assert.equal(undone.loops[0].revision, 2);
  assert.equal(undone.loops[0].lastMutationId, null);
  assert.throws(() => changeLocalDirection(undone, ids[0], 2, "", ids[1], now, ids[2]), /latest direction/);
});

test("guest state does not overwrite signed-in state and corrupt records fail closed", () => {
  assert.notEqual(pulseWorkspaceKey(), pulseWorkspaceKey("guest"));
  assert.notEqual(pulseWorkspaceKey("one"), pulseWorkspaceKey("two"));
  assert.throws(() => parsePulseWorkspace('{"version":2}'));
  assert.deepEqual(parsePulseWorkspace(null), emptyPulseWorkspace());
});
