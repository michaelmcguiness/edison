import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { evidencePassageOccurs, evidenceUrl, isPublicEvidenceAddress,
  MAX_EVIDENCE_BODY_BYTES, readBoundedEvidenceBody, readableEvidenceText,
  retrieveEvidencePage, type EvidenceTransport } from "./evidence-retrieval";

test("raw publisher HTML above the old shell limit is accepted only up to the exact byte cap", async () => {
  const full = Buffer.alloc(MAX_EVIDENCE_BODY_BYTES, "x");
  assert.equal((await readBoundedEvidenceBody(Readable.from([full]))).length, MAX_EVIDENCE_BODY_BYTES);
  const oversized = Readable.from([full, Buffer.from("x")]);
  await assert.rejects(readBoundedEvidenceBody(oversized), /evidence_content_too_large/);
  assert.equal(oversized.destroyed, true);
});

test("declared oversized content is stopped before reading and a false small length cannot bypass counting", async () => {
  let reads = 0;
  const declared = new Readable({ read() { reads += 1; this.push(null); } });
  await assert.rejects(readBoundedEvidenceBody(declared, String(MAX_EVIDENCE_BODY_BYTES + 1)), /too_large/);
  assert.equal(reads, 0);
  assert.equal(declared.destroyed, true);
  await assert.rejects(readBoundedEvidenceBody(
    Readable.from([Buffer.alloc(MAX_EVIDENCE_BODY_BYTES + 1)]), "1"), /too_large/);
});

test("stream byte counting handles split UTF-8 and rejects oversized multi-byte pages", async () => {
  const bytes = Buffer.from("Science – evidence");
  assert.equal(await readBoundedEvidenceBody(Readable.from([bytes.subarray(0, 9), bytes.subarray(9)])),
    "Science – evidence");
  await assert.rejects(readBoundedEvidenceBody(Readable.from([
    Buffer.from("é".repeat(MAX_EVIDENCE_BODY_BYTES / 2 + 1)),
  ])), /too_large/);
});

test("failed streams do not yield partial evidence", async () => {
  const interrupted = Readable.from((async function* () {
    yield Buffer.from("Evidence before a broken response. ".repeat(10));
    throw new Error("connection_interrupted");
  })());
  await assert.rejects(readBoundedEvidenceBody(interrupted), /connection_interrupted/);
  assert.equal(interrupted.destroyed, true);
});

test("injected transport also rejects oversized whole pages rather than trimming them", async () => {
  await assert.rejects(retrieveEvidencePage("https://example.org", {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    read: async () => ({ status: 200, contentType: "text/plain",
      text: "é".repeat(MAX_EVIDENCE_BODY_BYTES / 2 + 1) }),
  }), /evidence_content_too_large/);
});

test("evidence retrieval rejects private, mapped, reserved and tunnel addresses", () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "169.254.169.254", "100.64.0.1", "192.168.1.1",
    "192.0.2.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::7f00:1",
    "2002:7f00:1::", "2001:db8::1", "not-an-ip"]) assert.equal(isPublicEvidenceAddress(ip), false, ip);
  assert.equal(isPublicEvidenceAddress("8.8.8.8"), true);
  assert.equal(isPublicEvidenceAddress("2606:4700:4700::1111"), true);
});

test("only credential-free HTTPS evidence on the default port is accepted", () => {
  for (const url of ["http://example.org", "https://user:secret@example.org", "https://example.org:8443",
    "https://127.1", "https://0x7f000001", "file:///etc/passwd", "https://[::ffff:127.0.0.1]"]) {
    assert.throws(() => evidenceUrl(url));
  }
  assert.equal(evidenceUrl("https://example.org/paper#section").href, "https://example.org/paper");
});

test("passage extraction removes active markup and requires actual retained text", () => {
  const text = readableEvidenceText('<script>fabricated evidence</script><p>Cells &amp; circuits have limits. A result in one setting does not establish a universal conclusion.</p>');
  assert.equal(text.includes("fabricated"), false);
  assert.equal(evidencePassageOccurs(text, "A result in one setting does not establish a universal conclusion."), true);
  assert.equal(evidencePassageOccurs(text, "The experiment proves that every engineered cell is predictable."), false);
  assert.equal(evidencePassageOccurs(text, "Cells"), false);
});

test("all DNS answers and every redirect are checked before a pinned connection", async () => {
  let calls = 0;
  const deps: EvidenceTransport = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    read: async (_url, address) => {
      assert.equal(address.address, "8.8.8.8"); calls += 1;
      return { status: 302, location: "https://169.254.169.254/latest", contentType: "", text: "" };
    },
  };
  await assert.rejects(retrieveEvidencePage("https://example.org", deps), /forbidden/);
  assert.equal(calls, 1);
  await assert.rejects(retrieveEvidencePage("https://example.org", { ...deps,
    resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }],
  }), /forbidden/);
  assert.equal(calls, 1);
});

test("redirects are bounded and retrieved text carries actual retrieval time", async () => {
  const deps: EvidenceTransport = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    read: async () => ({ status: 200, contentType: "text/html", text: `<p>${"Evidence and its limitations. ".repeat(10)}</p>` }),
  };
  const result = await retrieveEvidencePage("https://example.org", deps);
  assert.ok(result.text.startsWith("Evidence"));
  assert.ok(Number.isFinite(Date.parse(result.retrievedAt)));
  await assert.rejects(retrieveEvidencePage("https://example.org", { ...deps,
    read: async () => ({ status: 302, location: "/again", contentType: "", text: "" }),
  }), /redirect_limit/);
});
