import assert from "node:assert/strict";
import test from "node:test";
import { buildContentSecurityPolicy } from "../lib/supabase/proxy";

test("production CSP uses a strict nonce and only configured connection origins", () => {
  const policy = buildContentSecurityPolicy("safeNonce123=", {
    development: false,
    apiUrl: "https://api.edisonreader.com/v1",
    supabaseUrl: "https://reader.supabase.co/auth/v1",
  });

  assert.match(policy, /script-src 'self' 'nonce-safeNonce123=' 'strict-dynamic'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.match(policy, /connect-src 'self' https:\/\/api\.edisonreader\.com wss:\/\/api\.edisonreader\.com https:\/\/reader\.supabase\.co wss:\/\/reader\.supabase\.co/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
});

test("development CSP permits only local tooling additions", () => {
  const policy = buildContentSecurityPolicy("dev_nonce", {
    development: true,
    apiUrl: "javascript:alert(1)",
    supabaseUrl: "not a url",
  });

  assert.match(policy, /'unsafe-eval'/);
  assert.match(policy, /http:\/\/localhost:\*/);
  assert.doesNotMatch(policy, /javascript:|not a url|upgrade-insecure/);
});

test("CSP rejects a nonce that could inject another directive", () => {
  assert.throws(
    () => buildContentSecurityPolicy("bad'; img-src *", { development: false }),
    /base64-safe/,
  );
});
