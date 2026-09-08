import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clearResolvedLoopEditAttempt } from "../components/edison/demand-v10/loop-editor";

const id = (n: number) => `loop-edit:00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = "edison:demand:loop-editor:workspace:loop:attempt";
const draftKey = key.slice(0, -":attempt".length);
const draft = { name: "Biology", instructions: "  Keep this literal instruction.\n" };
const attempt = (n: number) => ({ id: id(n), fingerprint: JSON.stringify(draft), baseRevision: n, deleting: false, draft });

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((accept, deny) => { resolve = accept; reject = deny; });
  return { promise, resolve, reject };
}

for (const outcome of ["success", "rejection"] as const) test(`late original A ${outcome} cannot clear B after remount and recovery`, async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (name: string) => storage.get(name) ?? null,
      setItem: (name: string, value: string) => { storage.set(name, value); },
    } });
    const a = attempt(1);
    storage.set(key, JSON.stringify(a));
    storage.set(draftKey, JSON.stringify(draft));
    const original = deferred();
    const oldCompletion = original.promise.then(
      () => clearResolvedLoopEditAttempt(key, a.id),
      () => clearResolvedLoopEditAttempt(key, a.id),
    );

    // A remounted editor replays the retained operation and confirms it first.
    const restoredA = JSON.parse(storage.get(key)!);
    assert.equal(restoredA.id, a.id);
    assert.equal(clearResolvedLoopEditAttempt(key, restoredA.id), true);
    // B has identical text but is a distinct logical operation at a new revision.
    const b = attempt(2);
    const retainedB = JSON.stringify(b);
    storage.set(key, retainedB);
    if (outcome === "success") original.resolve(); else original.reject(new Error("Definitive old admission rejection"));
    assert.equal(await oldCompletion, false);
    assert.equal(storage.get(key), retainedB);
    assert.deepEqual(JSON.parse(storage.get(draftKey)!), draft);
    assert.equal(JSON.parse(storage.get(key)!).id, b.id, "the next remount recovers B, not a fresh request");
    assert.equal(clearResolvedLoopEditAttempt(key, b.id), true);
    assert.equal(storage.get(key), "null");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("absent, malformed or unavailable storage never authorizes persistent cleanup", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const raw of [null, "null", "not json", JSON.stringify({ id: id(1) })]) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
        getItem: () => raw,
        setItem: () => { throw new Error("must not write without a validated matching operation"); },
      } });
      assert.equal(clearResolvedLoopEditAttempt(key, id(1)), false);
    }
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("storage blocked"); } });
    assert.equal(clearResolvedLoopEditAttempt(key, id(1)), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("success and rejection both use identity cleanup, while uncertain failures retain recovery", () => {
  const source = readFileSync(new URL("../components/edison/demand-v10/loop-editor.tsx", import.meta.url), "utf8");
  const submit = source.slice(source.indexOf("async function submit"), source.indexOf("return <section"));
  assert.equal(submit.match(/clearResolvedLoopEditAttempt\(`\$\{key\}:attempt`, currentAttempt.id\)/g)?.length, 2);
  assert.doesNotMatch(submit, /saveScopedDraft\(`\$\{key\}:attempt`, null\)/);
  assert.match(submit, /if \(ownsPersistedAttempt && !currentAttempt.deleting\) saveScopedDraft\(key, resolved.draft\)/);
  assert.equal(submit.match(/if \(mounted.current && ownsInstanceAttempt\)/g)?.length, 2);
  assert.match(submit, /setUncertain\(rejected \? null : currentAttempt\)/);
  assert.match(submit, /finally \{ lock.current = false; if \(mounted.current\) setPending\(false\); \}/);
});
