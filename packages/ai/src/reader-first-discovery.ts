/** Selected only by new article admissions; absence preserves exact legacy
 * provenance matching, including historical failed and cached responses. */
export const READER_FIRST_DISCOVERY_CONTRACT_VERSION = "edison-reader-first-v2.5-discovery-v1" as const;
export type ReaderFirstDiscoveryContractVersion = typeof READER_FIRST_DISCOVERY_CONTRACT_VERSION;
export type ReaderFirstDiscoveryOptions = { discoveryContractVersion?: ReaderFirstDiscoveryContractVersion };

export function usesReaderFirstDiscoveryContract(options: ReaderFirstDiscoveryOptions) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Unsupported reader-first discovery contract");
  if (!Object.hasOwn(options, "discoveryContractVersion")) return false;
  if (options.discoveryContractVersion !== READER_FIRST_DISCOVERY_CONTRACT_VERSION) throw new Error("Unsupported reader-first discovery contract");
  return true;
}

function nobelTrackingIdentity(value: string): string | null {
  // Never decode/reorder the path or query, infer another hostname, drop a
  // fragment, or treat arbitrary publishers' query keys as tracking. The raw
  // prefix must be identical; this permits only one literal nonempty trk value.
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  const match = /^(https:\/\/www\.nobelprize\.org\/[^?#]*)\?trk=([^&#]+)(#.*)?$/.exec(value);
  if (!match) return null;
  try {
    const url = new URL(value);
    if (url.origin !== "https://www.nobelprize.org" || url.username || url.password ||
      url.pathname !== match[1].slice(url.origin.length)) return null;
    return `${match[1]}${match[3] ?? ""}`;
  } catch { return null; }
}

/** Returns an original actually observed URL, never a synthesized fetch URL.
 * An exact match wins; otherwise ambiguity and all unapproved differences fail
 * closed. The caller still validates source structure, identity and retrieval. */
export function matchReaderFirstDiscoveryUrl(hint: string, observedUrls: Iterable<string>): string | null {
  const observed = new Set(observedUrls);
  if (observed.has(hint)) return hint;
  const identity = nobelTrackingIdentity(hint);
  if (identity === null) return null;
  const matches = [...observed].filter((url) => nobelTrackingIdentity(url) === identity);
  return matches.length === 1 ? matches[0] : null;
}
