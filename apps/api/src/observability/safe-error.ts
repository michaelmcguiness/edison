function safeIdentifier(value: unknown, pattern: RegExp, maximum: number) {
  return typeof value === "string" &&
      value.length <= maximum &&
      pattern.test(value)
    ? value
    : null;
}

/**
 * Return only explicitly allowlisted operational error metadata. Never copy a
 * caught object's message, stack, body, cause, headers, or arbitrary fields.
 */
export function safeCaughtErrorMetadata(error: unknown) {
  const record =
    error !== null && typeof error === "object"
      ? (error as Record<string, unknown>)
      : null;
  const errorName = safeIdentifier(
    error instanceof Error ? error.name : null,
    /^[A-Za-z][A-Za-z0-9_.-]*$/,
    80,
  );
  // OpenAI's SDK exposes the response-header request identity as requestID.
  const providerRequestId = safeIdentifier(
    record?.requestID,
    /^req_[A-Za-z0-9._:-]+$/,
    128,
  );

  return {
    errorName: errorName ?? "UnknownError",
    ...(providerRequestId ? { providerRequestId } : {}),
  };
}

export function attachSafeProviderRequestId<T extends Error>(
  target: T,
  source: unknown,
) {
  const metadata = safeCaughtErrorMetadata(source);
  if ("providerRequestId" in metadata) {
    Object.defineProperty(target, "requestID", {
      configurable: false,
      enumerable: false,
      value: metadata.providerRequestId,
      writable: false,
    });
  }
  return target;
}
