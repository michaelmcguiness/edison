import assert from "node:assert/strict";
import test from "node:test";
import { evidencePassageOccurs, evidenceUrl, isPublicEvidenceAddress,
  readableEvidenceText, retrieveEvidencePage, type EvidenceTransport } from "./evidence-retrieval";

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
