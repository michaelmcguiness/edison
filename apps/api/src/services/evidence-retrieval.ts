import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type { Readable } from "node:stream";

// Retrieved pages are untrusted evidence, never executable instructions. Each
// hop is resolved and pinned independently; fetch() alone would permit DNS
// rebinding between a safety lookup and the eventual connection.
const denied = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) denied.addSubnet(network, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
denied.addSubnet("2001::", 23, "ipv6");
denied.addSubnet("2001:db8::", 32, "ipv6");
denied.addSubnet("2002::", 16, "ipv6");

export function isPublicEvidenceAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, "ipv4");
  if (family === 6) {
    return globalV6.check(address, "ipv6") && !denied.check(address, "ipv6");
  }
  return false;
}

export function evidenceUrl(value: string): URL {
  if (value.length > 2048) throw new Error("evidence_url_invalid");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443")) throw new Error("evidence_url_invalid");
  url.hash = "";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicEvidenceAddress(host)) {
    throw new Error("evidence_address_forbidden");
  }
  return url;
}

// Publisher HTML often includes large navigation/metadata shells. This bounds
// raw transfer, not retained model evidence (which has a separate packet cap).
export const MAX_EVIDENCE_BODY_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** Stop on the first oversized chunk; never return a truncated source page. */
export async function readBoundedEvidenceBody(
  response: Readable, declaredLength?: string,
): Promise<string> {
  if (declaredLength && /^\d+$/.test(declaredLength) &&
      BigInt(declaredLength) > BigInt(MAX_EVIDENCE_BODY_BYTES)) {
    response.destroy();
    throw new Error("evidence_content_too_large");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of response) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > MAX_EVIDENCE_BODY_BYTES) {
        throw new Error("evidence_content_too_large");
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, length).toString("utf8");
  } catch (error) {
    response.destroy();
    throw error;
  }
}

export function readableEvidenceText(markup: string): string {
  return markup
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code: string) => {
      const value = code[0].toLowerCase() === "x"
        ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value) : " ";
    })
    .replace(/&(amp|quot|apos|lt|gt|nbsp|ndash|mdash|lsquo|rsquo|ldquo|rdquo);/gi,
      (_, entity: string) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">",
        nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" })[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ").trim();
}

export function normalizeEvidencePassage(value: string): string {
  return value.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s+/g, " ").trim();
}

/** Exact normalized passage presence, not a semantic factual-support verdict. */
export function evidencePassageOccurs(page: string, passage: string): boolean {
  const normalized = normalizeEvidencePassage(passage);
  return normalized.length >= 40 && normalized.length <= 4_000 &&
    normalizeEvidencePassage(page).includes(normalized);
}

type Address = { address: string; family: number };
export type EvidenceTransport = {
  resolve(host: string): Promise<Address[]>;
  read(url: URL, address: Address, signal: AbortSignal): Promise<{
    status: number; location?: string; contentType: string; text: string;
  }>;
};

const transport: EvidenceTransport = {
  resolve: (host) => lookup(host, { all: true, verbatim: true }),
  read: (url, address, signal) => new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      signal, agent: false, family: address.family,
      // Disable pooled connections and pin lookup; TLS still verifies the
      // original URL hostname. No cookies, bearer credentials, or referrer.
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: { Accept: "text/html, text/plain;q=0.9", "Accept-Encoding": "identity",
        "User-Agent": "EdisonReaderEvidence/1.0" },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      const contentType = String(response.headers["content-type"] ?? "");
      if (status >= 300 && status < 400) {
        response.destroy();
        resolve({ status, location, contentType, text: "" });
        return;
      }
      if (status !== 200 || !/^(text\/(html|plain|markdown)|application\/xhtml\+xml)(;|$)/i.test(contentType) ||
          (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.destroy(); reject(new Error("evidence_content_unavailable")); return;
      }
      void readBoundedEvidenceBody(response, response.headers["content-length"])
        .then((text) => resolve({ status, contentType, text }), reject);
    });
    req.on("error", reject);
    req.end();
  }),
};

export async function retrieveEvidencePage(
  value: string,
  dependencies: EvidenceTransport = transport,
): Promise<{ url: string; text: string; title: string | null; retrievedAt: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("evidence_timeout")); }, TIMEOUT_MS);
  });
  const retrieve = async () => {
    let url = evidenceUrl(value);
    for (let hop = 0; hop <= 3; hop += 1) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
        : await dependencies.resolve(host);
      if (controller.signal.aborted) throw new Error("evidence_timeout");
      if (!addresses.length || addresses.some(({ address }) => !isPublicEvidenceAddress(address))) {
        throw new Error("evidence_address_forbidden");
      }
      const response = await dependencies.read(url, addresses[0], controller.signal);
      if (response.status >= 300 && response.status < 400 && response.location) {
        url = evidenceUrl(new URL(response.location, url).href);
        continue;
      }
      if (response.status !== 200) throw new Error("evidence_content_unavailable");
      // Keep the public transport seam subject to the same full-page bound.
      if (Buffer.byteLength(response.text, "utf8") > MAX_EVIDENCE_BODY_BYTES) {
        throw new Error("evidence_content_too_large");
      }
      const text = readableEvidenceText(response.text);
      if (text.length < 100) throw new Error("evidence_content_unavailable");
      const rawTitle = /(?:text\/html|application\/xhtml\+xml)/i.test(response.contentType)
        ? /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(response.text)?.[1] : undefined;
      const title = rawTitle ? readableEvidenceText(rawTitle).slice(0, 300) || null : null;
      return { url: url.href, text, title, retrievedAt: new Date().toISOString() };
    }
    throw new Error("evidence_redirect_limit");
  };
  try { return await Promise.race([retrieve(), timeout]); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
