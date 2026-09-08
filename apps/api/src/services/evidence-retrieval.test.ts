import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { evidencePassageOccurs, evidenceUrl, isPublicEvidenceAddress,
  isEvidenceAccessInterstitial,
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

test("HTTP200 access-check pages cannot become retained evidence", async () => {
  const challenge = "Checking your browser - reCAPTCHA Checking your browser before accessing pmc.ncbi.nlm.nih.gov ... Click here if you are not automatically redirected after 5 seconds.";
  assert.equal(isEvidenceAccessInterstitial(challenge, "Checking your browser - reCAPTCHA"), true);
  assert.equal(isEvidenceAccessInterstitial(challenge, null), true);
  assert.equal(isEvidenceAccessInterstitial("A CAPTCHA is a test intended to distinguish people from automated programs. This article explains its design and limitations.", "How CAPTCHA works"), false);
  await assert.rejects(retrieveEvidencePage("https://example.org/paper", {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    read: async () => ({ status: 200, contentType: "text/html", text: `<title>Checking your browser - reCAPTCHA</title><p>${challenge}</p>` }),
  }), /evidence_access_interstitial/);
});

const pubmedRecord = JSON.stringify([{ documents: [{ id: "41151575", infons: {}, passages: [
  { infons: { type: "title" }, text: "A constructed medical technology review" },
  { infons: { type: "abstract" }, text: "This constructed abstract describes a proposed biological control system. It also explains that a proposal does not establish human safety or efficacy." },
] }] }]);

test("exact NCBI identities use a pinned official API and retain the canonical source plus actual transport", async () => {
  const reads: string[] = []; const hosts: string[] = [];
  const page = await retrieveEvidencePage("https://pubmed.ncbi.nlm.nih.gov/41151575/", {
    resolve: async (host) => { hosts.push(host); return [{ address: "8.8.8.8", family: 4 }]; },
    read: async (url, address) => {
      assert.equal(address.address, "8.8.8.8"); reads.push(url.href);
      return { status: 200, contentType: "application/json", text: pubmedRecord };
    },
  });
  assert.deepEqual(hosts, ["www.ncbi.nlm.nih.gov"]);
  assert.deepEqual(reads, ["https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pubmed.cgi/BioC_json/41151575/unicode"]);
  assert.equal(page.url, "https://pubmed.ncbi.nlm.nih.gov/41151575/");
  assert.equal(page.retrievalUrl, reads[0]);
  assert.ok(page.text.includes("does not establish human safety or efficacy"));
  assert.ok(Number.isFinite(Date.parse(page.retrievedAt)));
});

test("NCBI access errors, HTML challenges and redirects never trigger fallback or retries", async () => {
  for (const response of [
    { status: 429, contentType: "application/json", text: "{}" },
    { status: 302, contentType: "", text: "", location: "https://example.org/replacement" },
    { status: 200, contentType: "text/html", text: "Checking your browser before accessing PMC. ".repeat(4) },
  ]) {
    let reads = 0;
    await assert.rejects(retrieveEvidencePage("https://pubmed.ncbi.nlm.nih.gov/41151575/", {
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      read: async () => { reads++; return response; },
    }), /evidence_content_unavailable/);
    assert.equal(reads, 1);
  }
});

test("unsupported NCBI article forms and unrelated JSON are not scraped as prose", async () => {
  let reads = 0;
  const deps: EvidenceTransport = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    read: async () => { reads++; return { status: 200, contentType: "application/json", text: pubmedRecord }; },
  };
  for (const url of ["https://pmc.ncbi.nlm.nih.gov/articles/PMC12366578/pdf/", "https://pubmed.ncbi.nlm.nih.gov/?term=cells"]) {
    await assert.rejects(retrieveEvidencePage(url, deps), /evidence_content_unavailable/);
  }
  assert.equal(reads, 0);
  await assert.rejects(retrieveEvidencePage("https://example.org/data", deps), /evidence_content_unavailable/);
  assert.equal(reads, 1);
});

test("a generic redirect cannot bypass the NCBI no-interactive-HTML boundary", async () => {
  for (const location of ["https://pmc.ncbi.nlm.nih.gov/articles/PMC12366578/", "https://pubmed.ncbi.nlm.nih.gov/41151575/",
    "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12366578/"]) {
    const reads: string[] = [];
    await assert.rejects(retrieveEvidencePage("https://example.org/redirect", {
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      read: async (url) => { reads.push(url.href); return { status: 302, contentType: "", text: "", location }; },
    }), /evidence_content_unavailable/);
    assert.deepEqual(reads, ["https://example.org/redirect"]);
  }
});

test("NCBI transport applies private DNS denial and the same whole-body limit", async () => {
  let reads = 0;
  const url = "https://pubmed.ncbi.nlm.nih.gov/41151575/";
  const deps: EvidenceTransport = {
    resolve: async () => [{ address: "10.0.0.1", family: 4 }],
    read: async () => { reads++; return { status: 200, contentType: "application/json", text: "x".repeat(MAX_EVIDENCE_BODY_BYTES + 1) }; },
  };
  await assert.rejects(retrieveEvidencePage(url, deps), /evidence_address_forbidden/);
  assert.equal(reads, 0);
  await assert.rejects(retrieveEvidencePage(url, { ...deps, resolve: async () => [{ address: "8.8.8.8", family: 4 }] }), /evidence_content_too_large/);
  assert.equal(reads, 1);
});

test("parallel NCBI callers serialize and start no faster than twice per second in this process", async () => {
  const starts: number[] = []; let active = 0; let maximumActive = 0;
  const deps: EvidenceTransport = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    read: async () => {
      starts.push(Date.now()); active++; maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return { status: 200, contentType: "application/json", text: pubmedRecord };
    },
  };
  await Promise.all(Array.from({ length: 3 }, () => retrieveEvidencePage("https://pubmed.ncbi.nlm.nih.gov/41151575/", deps)));
  assert.equal(maximumActive, 1);
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 490 && starts[2] - starts[1] >= 490);
});
