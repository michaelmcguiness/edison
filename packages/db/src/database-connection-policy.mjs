const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const SECURE_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

const POLICY_MESSAGES = {
  invalid_url: "DATABASE_URL must be a valid PostgreSQL URL",
  ambiguous_tls:
    "DATABASE_URL contains duplicate or conflicting TLS options",
  insecure_tls:
    "DATABASE_URL contains an insecure or unsupported TLS option",
};

export class DatabaseConnectionPolicyError extends Error {
  /** @param {keyof typeof POLICY_MESSAGES} code */
  constructor(code) {
    super(POLICY_MESSAGES[code]);
    this.name = "DatabaseConnectionPolicyError";
    this.code = code;
  }
}

function invalidUrl() {
  throw new DatabaseConnectionPolicyError("invalid_url");
}

/**
 * Resolve the explicit Postgres.js TLS option used by Edison. Production always
 * supplies `ssl`, so URL query parameters and PGSSL cannot silently override it.
 * Non-production deliberately leaves the driver default untouched for local DBs.
 *
 * @param {string} connectionString
 * @param {{ production?: boolean }} [options]
 * @returns {{
 *   connectionString: string,
 *   ssl: "require" | "verify-full" | undefined,
 *   tlsDefaulted: boolean,
 * }}
 */
export function resolveDatabaseConnectionPolicy(
  connectionString,
  { production = false } = {},
) {
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    invalidUrl();
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    invalidUrl();
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) invalidUrl();

  if (!production) {
    return { connectionString, ssl: undefined, tlsDefaulted: false };
  }

  const sslModeEntries = [];
  const sslEntries = [];
  const unsupportedTlsEntries = [];
  for (const [rawName, rawValue] of parsed.searchParams) {
    const name = rawName.toLowerCase();
    if (name === "sslmode") sslModeEntries.push({ rawName, rawValue });
    else if (name === "ssl") sslEntries.push({ rawName, rawValue });
    else if (name === "sslrootcert") unsupportedTlsEntries.push({ rawName, rawValue });
  }

  if (
    sslModeEntries.length > 1 ||
    sslEntries.length > 1 ||
    (sslModeEntries.length && sslEntries.length) ||
    unsupportedTlsEntries.length
  ) {
    throw new DatabaseConnectionPolicyError("ambiguous_tls");
  }

  const selected = sslModeEntries[0] ?? sslEntries[0];
  if (!selected) {
    return { connectionString, ssl: "require", tlsDefaulted: true };
  }

  // Postgres.js treats query names and values case-sensitively. Reject variants
  // that could look secure to a human but mean something different to the driver.
  if (selected.rawName !== selected.rawName.toLowerCase()) {
    throw new DatabaseConnectionPolicyError("ambiguous_tls");
  }
  const mode = selected.rawValue;
  const accepted =
    SECURE_SSL_MODES.has(mode) ||
    (selected.rawName === "ssl" && mode === "true");
  if (!accepted) {
    throw new DatabaseConnectionPolicyError("insecure_tls");
  }

  // In Postgres.js 3.4.9, verify-ca already uses Node's certificate and hostname
  // verification. Normalize it to the typed verify-full option rather than
  // weakening that request or relying on an untyped driver string.
  const ssl = mode === "require" ? "require" : "verify-full";
  return { connectionString, ssl, tlsDefaulted: false };
}
