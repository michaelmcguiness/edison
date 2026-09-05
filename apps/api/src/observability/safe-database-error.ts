type DatabaseErrorCategory =
  | "authentication"
  | "availability"
  | "capacity"
  | "connection"
  | "database"
  | "internal"
  | "network"
  | "permission"
  | "query"
  | "schema"
  | "tls";

const databaseErrorCategories = {
  "08000": "connection",
  "08001": "connection",
  "08003": "connection",
  "08004": "connection",
  "08006": "connection",
  "08007": "connection",
  "08P01": "connection",
  "28000": "authentication",
  "28P01": "authentication",
  "0P000": "permission",
  "42501": "permission",
  "42601": "query",
  "3D000": "database",
  "3F000": "schema",
  "42703": "schema",
  "42704": "schema",
  "42883": "schema",
  "42P01": "schema",
  "53300": "capacity",
  "57P01": "availability",
  "57P02": "availability",
  "57P03": "availability",
  XX000: "internal",
  CERT_HAS_EXPIRED: "tls",
  CERT_NOT_YET_VALID: "tls",
  CONNECTION_CLOSED: "network",
  CONNECTION_DESTROYED: "network",
  CONNECT_TIMEOUT: "network",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls",
  EAI_AGAIN: "network",
  ECONNREFUSED: "network",
  ECONNRESET: "network",
  EHOSTUNREACH: "network",
  ENETUNREACH: "network",
  ENOTFOUND: "network",
  ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE: "tls",
  ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION: "tls",
  ERR_SSL_WRONG_VERSION_NUMBER: "tls",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls",
  ERR_TLS_HANDSHAKE_TIMEOUT: "tls",
  ETIMEDOUT: "network",
  SELF_SIGNED_CERT_IN_CHAIN: "tls",
  UNABLE_TO_GET_ISSUER_CERT: "tls",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "tls",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls",
} as const satisfies Record<string, DatabaseErrorCategory>;

type DatabaseErrorCode = keyof typeof databaseErrorCategories;

function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function ownDataProperty(value: object, name: "cause" | "code") {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function knownDatabaseError(code: unknown) {
  if (
    typeof code !== "string" ||
    !Object.hasOwn(databaseErrorCategories, code)
  ) {
    return null;
  }

  const databaseErrorCode = code as DatabaseErrorCode;
  return {
    databaseErrorCategory: databaseErrorCategories[databaseErrorCode],
    databaseErrorCode,
  };
}

/**
 * Traverse only a bounded chain of own data-property causes. The returned
 * values come exclusively from the fixed allowlist above; database error
 * messages and all other caught-object fields remain inaccessible to logs.
 */
export function safeDatabaseErrorMetadata(error: unknown) {
  const seen = new WeakSet<object>();
  let current = error;

  // Inspect the thrown value plus no more than four nested cause levels.
  for (let causeDepth = 0; causeDepth <= 4; causeDepth += 1) {
    if (!isObjectLike(current) || seen.has(current)) return {};
    seen.add(current);

    const known = knownDatabaseError(ownDataProperty(current, "code"));
    if (known) return known;

    current = ownDataProperty(current, "cause");
  }

  return {};
}
