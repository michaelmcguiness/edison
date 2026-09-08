import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "./errors";
import { apiHandler, publicApiHandler, readJsonBody } from "./api-handler";

function providerFailure() {
  return Object.assign(new Error("PROMPT-SENTINEL must never be logged"), {
    name: "APIError",
    requestID: "req_safe_123",
    error: {
      body: "ARTICLE-BODY-SENTINEL",
      prompt: "PROMPT-SENTINEL",
    },
  });
}

async function captureErrorLog(run: () => Promise<Response>) {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...values: unknown[]) => {
    calls.push(values);
  };
  try {
    const response = await run();
    return { response, calls };
  } finally {
    console.error = original;
  }
}

function assertSanitized(calls: unknown[][]) {
  assert.equal(calls.length, 1);
  const serialized = JSON.stringify(calls);
  assert.match(serialized, /req_safe_123/);
  assert.match(serialized, /APIError/);
  assert.match(serialized, /internal_error/);
  assert.doesNotMatch(serialized, /PROMPT-SENTINEL/);
  assert.doesNotMatch(serialized, /ARTICLE-BODY-SENTINEL/);
}

test("public 5xx logging emits only allowlisted error metadata", async () => {
  const { response, calls } = await captureErrorLog(() =>
    publicApiHandler(new Request("https://api.example.test/v1/public"), () => {
      throw providerFailure();
    }),
  );

  assert.equal(response.status, 500);
  assertSanitized(calls);
});

test("authenticated 5xx logging never emits a raw caught error", async () => {
  const previous = {
    nodeEnvironment: process.env.NODE_ENV,
    userId: process.env.EDISON_DEV_USER_ID,
    userEmail: process.env.EDISON_DEV_USER_EMAIL,
  };
  Reflect.set(process.env, "NODE_ENV", "development");
  process.env.EDISON_DEV_USER_ID = "10000000-0000-4000-8000-000000000001";
  process.env.EDISON_DEV_USER_EMAIL = "reader@example.test";

  try {
    const { response, calls } = await captureErrorLog(() =>
      apiHandler(new Request("https://api.example.test/v1/private"), () => {
        throw providerFailure();
      }),
    );

    assert.equal(response.status, 500);
    assertSanitized(calls);
  } finally {
    if (previous.nodeEnvironment === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      Reflect.set(process.env, "NODE_ENV", previous.nodeEnvironment);
    }
    if (previous.userId === undefined) delete process.env.EDISON_DEV_USER_ID;
    else process.env.EDISON_DEV_USER_ID = previous.userId;
    if (previous.userEmail === undefined) delete process.env.EDISON_DEV_USER_EMAIL;
    else process.env.EDISON_DEV_USER_EMAIL = previous.userEmail;
  }
});

test("bounded JSON reading accepts valid bodies at the byte limit", async () => {
  const body = JSON.stringify({ edition: "news" });
  const request = new Request("https://api.example.test/v1/admin/edition", {
    method: "POST",
    body,
  });

  assert.deepEqual(await readJsonBody(request, Buffer.byteLength(body)), {
    edition: "news",
  });
});

test("bounded JSON reading rejects an oversized declared body before parsing", async () => {
  const request = new Request("https://api.example.test/v1/admin/edition", {
    method: "POST",
    headers: { "Content-Length": "4097" },
    body: "{}",
  });

  await assert.rejects(
    () => readJsonBody(request, 4096),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 413 &&
      error.code === "request_too_large",
  );
});

test("bounded JSON reading enforces streamed bytes when length is absent", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"value":"'));
      controller.enqueue(encoder.encode("x".repeat(32)));
      controller.enqueue(encoder.encode('"}'));
      controller.close();
    },
  });
  const request = new Request("https://api.example.test/v1/admin/edition", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await assert.rejects(
    () => readJsonBody(request, 16),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 413 &&
      error.code === "request_too_large",
  );
});
