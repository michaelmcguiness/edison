import { createHash } from "node:crypto";

export const LOOP_PRINCIPLE_STATE_VERSION = "loop-principle-state.v1" as const;
export const LOOP_PRINCIPLE_CONTEXT_VERSION = "loop-principle-context.v1" as const;
export const LOOP_PRINCIPLE_FINGERPRINT_VERSION =
  "loop-principle-request.v1" as const;

export const MAX_ACTIVE_LOOP_PRINCIPLES = 20;
export const MAX_LOOP_PRINCIPLE_RECORDS = 40;
export const MAX_LOOP_PRINCIPLE_OPERATIONS = 12;
export const MAX_LOOP_PRINCIPLE_EVIDENCE_ENTRIES = 4;
export const MAX_LOOP_PRINCIPLE_TEXT_LENGTH = 500;
export const MAX_LOOP_PRINCIPLE_CONTEXT_BYTES = 64 * 1024;

export const LOOP_PRINCIPLE_KINDS = [
  "knowledge",
  "preference",
  "direction",
] as const;

export type LoopPrincipleKind = (typeof LOOP_PRINCIPLE_KINDS)[number];
export type LoopPrincipleEvidenceSource =
  | "original-curiosity"
  | "reader-feedback";

export type LoopPrincipleEvidenceInput = {
  source: LoopPrincipleEvidenceSource;
  sourceId: string;
  exactText: string;
};

export type LoopPrincipleEvidence = LoopPrincipleEvidenceInput & {
  recordedRevision: number;
};

export type LoopPrinciple = {
  id: string;
  kind: LoopPrincipleKind;
  instruction: string;
  status: "active" | "removed";
  order: number;
  evidence: readonly LoopPrincipleEvidence[];
  removedBy: LoopPrincipleEvidence | null;
  createdRevision: number;
  updatedRevision: number;
  removedRevision: number | null;
};

export type AddLoopPrincipleOperation = {
  op: "add";
  principle: {
    id: string;
    kind: LoopPrincipleKind;
    instruction: string;
  };
};

export type ReplaceLoopPrincipleOperation = {
  op: "replace";
  principleId: string;
  kind: LoopPrincipleKind;
  instruction: string;
};

export type RemoveLoopPrincipleOperation = {
  op: "remove";
  principleId: string;
};

export type LoopPrincipleOperation =
  | AddLoopPrincipleOperation
  | ReplaceLoopPrincipleOperation
  | RemoveLoopPrincipleOperation;

type LoopPrincipleRequestBase = {
  loopId: string;
  mutationId: string;
  idempotencyKey: string;
  expectedRevision: number;
};

export type ApplyLoopPrincipleRequest = LoopPrincipleRequestBase & {
  type: "apply";
  interpretationVersion: string;
  evidence: LoopPrincipleEvidenceInput;
  operations: readonly LoopPrincipleOperation[];
};

export type UndoLoopPrincipleRequest = LoopPrincipleRequestBase & {
  type: "undo";
  targetMutationId: string;
};

export type LoopPrincipleRequest =
  | ApplyLoopPrincipleRequest
  | UndoLoopPrincipleRequest;

export type LoopPrincipleMutation = {
  mutationId: string;
  requestFingerprint: string;
  beforeRevision: number;
  appliedRevision: number;
  beforePrinciples: readonly LoopPrinciple[];
};

export type LoopPrincipleState = {
  version: typeof LOOP_PRINCIPLE_STATE_VERSION;
  loopId: string;
  originalCuriosity: string;
  revision: number;
  principles: readonly LoopPrinciple[];
  lastMutation: LoopPrincipleMutation | null;
};

export type LoopPrincipleRequestReceipt = {
  loopId: string;
  requestType: LoopPrincipleRequest["type"];
  idempotencyKey: string;
  requestFingerprint: string;
  mutationId: string;
  resultRevision: number;
};

export type LoopPrincipleReduction = {
  state: LoopPrincipleState;
  receipt: LoopPrincipleRequestReceipt;
  replayed: boolean;
};

export type LoopPrincipleContextItem = {
  id: string;
  instruction: string;
  evidence: readonly LoopPrincipleEvidence[];
};

export type LoopPrincipleContext = {
  version: typeof LOOP_PRINCIPLE_CONTEXT_VERSION;
  loopId: string;
  loopRevision: number;
  originalCuriosity: string;
  principles: {
    knowledge: readonly LoopPrincipleContextItem[];
    preferences: readonly LoopPrincipleContextItem[];
    directions: readonly LoopPrincipleContextItem[];
  };
  interpretationPolicy: {
    evidenceBasis: "explicit-reader-statements-only";
    declaredKnowledge: "reader-declared-not-verified";
    articleActivity: "not-evidence-of-knowledge";
    masteryInference: "prohibited";
    defaults: "separate-from-reader-principles";
  };
};

export type LoopPrincipleContextAssembly =
  | {
      ok: true;
      context: LoopPrincipleContext;
      byteLength: number;
      maxBytes: number;
    }
  | {
      ok: false;
      code: "context_limit";
      loopId: string;
      loopRevision: number;
      activePrincipleCount: number;
      requiredBytes: number;
      maxBytes: number;
    };

export type LoopPrincipleErrorCode =
  | "invalid_request"
  | "invalid_state"
  | "stale_revision"
  | "idempotency_conflict"
  | "invalid_replay"
  | "principle_exists"
  | "principle_not_found"
  | "principle_inactive"
  | "limit_exceeded"
  | "no_effect"
  | "invalid_undo";

const errorMessages: Record<LoopPrincipleErrorCode, string> = {
  invalid_request: "The loop principle request is invalid.",
  invalid_state: "The loop principle state is invalid.",
  stale_revision: "The loop changed before this request could be applied.",
  idempotency_conflict: "The idempotency key was already used for another request.",
  invalid_replay: "The stored loop principle replay receipt is invalid.",
  principle_exists: "The loop principle already exists.",
  principle_not_found: "The loop principle does not exist.",
  principle_inactive: "The loop principle is not active.",
  limit_exceeded: "The loop principle limit was exceeded.",
  no_effect: "The loop principle request would not change the loop.",
  invalid_undo: "Only the latest unreverted loop principle mutation can be undone.",
};

export class LoopPrincipleError extends Error {
  constructor(readonly code: LoopPrincipleErrorCode) {
    super(errorMessages[code]);
    this.name = "LoopPrincipleError";
  }
}

export function createEmptyLoopPrincipleState(input: {
  loopId: string;
  originalCuriosity: string;
}): LoopPrincipleState {
  assertIdentifier(input.loopId, "invalid_request");
  assertExactText(input.originalCuriosity, "invalid_request");

  return {
    version: LOOP_PRINCIPLE_STATE_VERSION,
    loopId: input.loopId,
    originalCuriosity: input.originalCuriosity,
    revision: 0,
    principles: [],
    lastMutation: null,
  };
}

/**
 * Fingerprints semantic request content, not caller-generated mutation or add IDs.
 * That lets a durable idempotency receipt recognize the same retry even if an
 * adapter regenerated those identifiers before loading the receipt.
 */
export function loopPrincipleRequestFingerprint(
  request: LoopPrincipleRequest,
): string {
  validateRequest(request);

  const payload =
    request.type === "apply"
      ? [
          LOOP_PRINCIPLE_FINGERPRINT_VERSION,
          "apply",
          request.loopId,
          request.expectedRevision,
          request.interpretationVersion,
          [
            request.evidence.source,
            request.evidence.sourceId,
            request.evidence.exactText,
          ],
          request.operations.map((operation) => {
            if (operation.op === "add") {
              return [
                "add",
                operation.principle.kind,
                operation.principle.instruction,
              ];
            }
            if (operation.op === "replace") {
              return [
                "replace",
                operation.principleId,
                operation.kind,
                operation.instruction,
              ];
            }
            return ["remove", operation.principleId];
          }),
        ]
      : [
          LOOP_PRINCIPLE_FINGERPRINT_VERSION,
          "undo",
          request.loopId,
          request.expectedRevision,
          request.targetMutationId,
        ];

  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

/**
 * Applies already-interpreted operations. This function deliberately performs
 * no natural-language parsing, semantic deduplication, or behavioral inference.
 * A durable adapter must look up and pass a prior receipt before calling it.
 */
export function reduceLoopPrinciples(input: {
  state: LoopPrincipleState;
  request: LoopPrincipleRequest;
  replay?: LoopPrincipleRequestReceipt | null;
  /** Opt in ONLY when the adapter atomically retains the exact request plus
   * before/after states in immutable history with the resulting state update.
   * The working context is not that history. Default callers retain all records. */
  historyIsDurable?: true;
}): LoopPrincipleReduction {
  validateState(input.state);
  validateRequest(input.request);

  if (input.request.loopId !== input.state.loopId) {
    throw new LoopPrincipleError("invalid_request");
  }

  const requestFingerprint = loopPrincipleRequestFingerprint(input.request);
  if (input.replay) {
    validateReplay(input.replay, input.state);
    if (
      input.replay.loopId !== input.request.loopId ||
      input.replay.idempotencyKey !== input.request.idempotencyKey ||
      input.replay.requestType !== input.request.type ||
      input.replay.requestFingerprint !== requestFingerprint
    ) {
      throw new LoopPrincipleError("idempotency_conflict");
    }

    return {
      state: input.state,
      receipt: input.replay,
      replayed: true,
    };
  }

  if (input.request.expectedRevision !== input.state.revision) {
    throw new LoopPrincipleError("stale_revision");
  }

  if (input.state.lastMutation?.mutationId === input.request.mutationId) {
    throw new LoopPrincipleError("invalid_request");
  }

  const nextRevision = input.state.revision + 1;
  const nextState =
    input.request.type === "apply"
      ? applyOperations(
          input.state,
          input.request,
          requestFingerprint,
          nextRevision,
          input.historyIsDurable === true,
        )
      : applyUndo(input.state, input.request, nextRevision);

  const receipt: LoopPrincipleRequestReceipt = {
    loopId: input.request.loopId,
    requestType: input.request.type,
    idempotencyKey: input.request.idempotencyKey,
    requestFingerprint,
    mutationId: input.request.mutationId,
    resultRevision: nextRevision,
  };

  return { state: nextState, receipt, replayed: false };
}

export function assembleLoopPrincipleContext(
  state: LoopPrincipleState,
  options: { maxBytes?: number } = {},
): LoopPrincipleContextAssembly {
  validateState(state);
  const maxBytes = options.maxBytes ?? MAX_LOOP_PRINCIPLE_CONTEXT_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_LOOP_PRINCIPLE_CONTEXT_BYTES
  ) {
    throw new LoopPrincipleError("invalid_request");
  }

  const active = state.principles
    .filter((principle) => principle.status === "active")
    .toSorted((left, right) => left.order - right.order);
  const item = (principle: LoopPrinciple): LoopPrincipleContextItem => ({
    id: principle.id,
    instruction: principle.instruction,
    evidence: principle.evidence.map(cloneEvidence),
  });

  const context: LoopPrincipleContext = {
    version: LOOP_PRINCIPLE_CONTEXT_VERSION,
    loopId: state.loopId,
    loopRevision: state.revision,
    originalCuriosity: state.originalCuriosity,
    principles: {
      knowledge: active.filter(({ kind }) => kind === "knowledge").map(item),
      preferences: active.filter(({ kind }) => kind === "preference").map(item),
      directions: active.filter(({ kind }) => kind === "direction").map(item),
    },
    interpretationPolicy: {
      evidenceBasis: "explicit-reader-statements-only",
      declaredKnowledge: "reader-declared-not-verified",
      articleActivity: "not-evidence-of-knowledge",
      masteryInference: "prohibited",
      defaults: "separate-from-reader-principles",
    },
  };
  const requiredBytes = new TextEncoder().encode(
    JSON.stringify(context),
  ).byteLength;

  if (requiredBytes > maxBytes) {
    return {
      ok: false,
      code: "context_limit",
      loopId: state.loopId,
      loopRevision: state.revision,
      activePrincipleCount: active.length,
      requiredBytes,
      maxBytes,
    };
  }

  return { ok: true, context, byteLength: requiredBytes, maxBytes };
}

function applyOperations(
  state: LoopPrincipleState,
  request: ApplyLoopPrincipleRequest,
  requestFingerprint: string,
  nextRevision: number,
  historyIsDurable: boolean,
): LoopPrincipleState {
  if (
    request.evidence.source === "original-curiosity" &&
    (request.evidence.sourceId !== state.loopId ||
      request.evidence.exactText !== state.originalCuriosity)
  ) {
    throw new LoopPrincipleError("invalid_request");
  }

  const targetIds = new Set<string>();
  for (const operation of request.operations) {
    const targetId =
      operation.op === "add" ? operation.principle.id : operation.principleId;
    if (targetIds.has(targetId)) {
      throw new LoopPrincipleError("invalid_request");
    }
    targetIds.add(targetId);
  }

  const previousPrinciples = clonePrinciples(state.principles);
  const principles = historyIsDurable
    ? compactWorkingPrinciples(state.principles)
    : clonePrinciples(state.principles);
  let nextOrder = principles.reduce(
    (maximum, principle) => Math.max(maximum, principle.order + 1),
    0,
  );

  for (const operation of request.operations) {
    const recordedEvidence: LoopPrincipleEvidence = {
      ...request.evidence,
      recordedRevision: nextRevision,
    };

    if (operation.op === "add") {
      if (principles.some(({ id }) => id === operation.principle.id) ||
          state.principles.some(({ id }) => id === operation.principle.id)) {
        throw new LoopPrincipleError("principle_exists");
      }
      if (principles.length >= MAX_LOOP_PRINCIPLE_RECORDS) {
        throw new LoopPrincipleError("limit_exceeded");
      }
      if (
        principles.filter(({ status }) => status === "active").length >=
        MAX_ACTIVE_LOOP_PRINCIPLES
      ) {
        throw new LoopPrincipleError("limit_exceeded");
      }

      principles.push({
        id: operation.principle.id,
        kind: operation.principle.kind,
        instruction: operation.principle.instruction,
        status: "active",
        order: nextOrder,
        evidence: [recordedEvidence],
        removedBy: null,
        createdRevision: nextRevision,
        updatedRevision: nextRevision,
        removedRevision: null,
      });
      nextOrder += 1;
      continue;
    }

    const index = principles.findIndex(
      ({ id }) => id === operation.principleId,
    );
    if (index < 0) {
      throw new LoopPrincipleError("principle_not_found");
    }
    const current = principles[index]!;
    if (current.status !== "active") {
      throw new LoopPrincipleError("principle_inactive");
    }

    if (operation.op === "remove") {
      principles[index] = {
        ...current,
        status: "removed",
        removedBy: recordedEvidence,
        updatedRevision: nextRevision,
        removedRevision: nextRevision,
      };
      continue;
    }

    if (
      current.kind === operation.kind &&
      current.instruction === operation.instruction
    ) {
      throw new LoopPrincipleError("no_effect");
    }
    if (!historyIsDurable && current.evidence.length >= MAX_LOOP_PRINCIPLE_EVIDENCE_ENTRIES) {
      throw new LoopPrincipleError("limit_exceeded");
    }
    principles[index] = {
      ...current,
      kind: operation.kind,
      instruction: operation.instruction,
      evidence: historyIsDurable
        ? [cloneEvidence(current.evidence[0]!), recordedEvidence]
        : [...current.evidence.map(cloneEvidence), recordedEvidence],
      updatedRevision: nextRevision,
    };
  }

  return {
    ...state,
    revision: nextRevision,
    principles: historyIsDurable ? compactWorkingPrinciples(principles) : principles,
    lastMutation: {
      mutationId: request.mutationId,
      requestFingerprint,
      beforeRevision: state.revision,
      appliedRevision: nextRevision,
      beforePrinciples: previousPrinciples,
    },
  };
}

/** Preserve every active instruction and its origin/current explicit evidence.
 * Removed records and intermediate evidence remain in the adapter's immutable
 * audit, and the unmodified pre-mutation snapshot remains available for Undo. */
function compactWorkingPrinciples(principles: readonly LoopPrinciple[]): LoopPrinciple[] {
  return clonePrinciples(principles.filter((principle) => principle.status === "active"))
    .map((principle) => ({
      ...principle,
      evidence: principle.evidence.length <= 2 ? principle.evidence
        : [cloneEvidence(principle.evidence[0]!), cloneEvidence(principle.evidence.at(-1)!)],
    }));
}

function applyUndo(
  state: LoopPrincipleState,
  request: UndoLoopPrincipleRequest,
  nextRevision: number,
): LoopPrincipleState {
  const mutation = state.lastMutation;
  if (
    !mutation ||
    mutation.mutationId !== request.targetMutationId ||
    mutation.appliedRevision !== state.revision
  ) {
    throw new LoopPrincipleError("invalid_undo");
  }

  return {
    ...state,
    revision: nextRevision,
    principles: clonePrinciples(mutation.beforePrinciples),
    lastMutation: null,
  };
}

function validateRequest(request: LoopPrincipleRequest) {
  if (!isRecord(request)) {
    throw new LoopPrincipleError("invalid_request");
  }
  assertIdentifier(request.loopId, "invalid_request");
  assertIdentifier(request.mutationId, "invalid_request");
  assertIdentifier(request.idempotencyKey, "invalid_request");
  assertRevision(request.expectedRevision, "invalid_request");

  if (request.type === "apply") {
    assertIdentifier(request.interpretationVersion, "invalid_request");
    validateEvidenceInput(request.evidence, "invalid_request");
    if (
      !Array.isArray(request.operations) ||
      request.operations.length < 1 ||
      request.operations.length > MAX_LOOP_PRINCIPLE_OPERATIONS
    ) {
      throw new LoopPrincipleError("invalid_request");
    }
    for (const operation of request.operations) validateOperation(operation);
    return;
  }

  if (request.type === "undo") {
    assertIdentifier(request.targetMutationId, "invalid_request");
    return;
  }

  throw new LoopPrincipleError("invalid_request");
}

function validateOperation(operation: LoopPrincipleOperation) {
  if (!isRecord(operation)) {
    throw new LoopPrincipleError("invalid_request");
  }

  if (operation.op === "add") {
    if (!isRecord(operation.principle)) {
      throw new LoopPrincipleError("invalid_request");
    }
    assertIdentifier(operation.principle.id, "invalid_request");
    assertKind(operation.principle.kind);
    assertExactText(operation.principle.instruction, "invalid_request");
    return;
  }

  if (operation.op === "replace") {
    assertIdentifier(operation.principleId, "invalid_request");
    assertKind(operation.kind);
    assertExactText(operation.instruction, "invalid_request");
    return;
  }

  if (operation.op === "remove") {
    assertIdentifier(operation.principleId, "invalid_request");
    return;
  }

  throw new LoopPrincipleError("invalid_request");
}

function validateEvidenceInput(
  evidence: LoopPrincipleEvidenceInput,
  code: LoopPrincipleErrorCode,
) {
  if (
    !isRecord(evidence) ||
    (evidence.source !== "original-curiosity" &&
      evidence.source !== "reader-feedback")
  ) {
    throw new LoopPrincipleError(code);
  }
  assertIdentifier(evidence.sourceId, code);
  assertExactText(evidence.exactText, code);
}

function validateState(state: LoopPrincipleState) {
  if (
    !isRecord(state) ||
    state.version !== LOOP_PRINCIPLE_STATE_VERSION
  ) {
    throw new LoopPrincipleError("invalid_state");
  }
  assertIdentifier(state.loopId, "invalid_state");
  assertExactText(state.originalCuriosity, "invalid_state");
  assertRevision(state.revision, "invalid_state");
  validatePrinciples(state.principles, state.revision, {
    loopId: state.loopId,
    originalCuriosity: state.originalCuriosity,
  });

  if (state.lastMutation === null) return;
  if (!isRecord(state.lastMutation)) {
    throw new LoopPrincipleError("invalid_state");
  }
  assertIdentifier(state.lastMutation.mutationId, "invalid_state");
  assertFingerprint(state.lastMutation.requestFingerprint, "invalid_state");
  assertRevision(state.lastMutation.beforeRevision, "invalid_state");
  assertRevision(state.lastMutation.appliedRevision, "invalid_state");
  if (
    state.lastMutation.appliedRevision !== state.revision ||
    state.lastMutation.beforeRevision + 1 !== state.lastMutation.appliedRevision
  ) {
    throw new LoopPrincipleError("invalid_state");
  }
  validatePrinciples(
    state.lastMutation.beforePrinciples,
    state.lastMutation.beforeRevision,
    { loopId: state.loopId, originalCuriosity: state.originalCuriosity },
  );
}

function validatePrinciples(
  principles: readonly LoopPrinciple[],
  maximumRevision: number,
  scope: { loopId: string; originalCuriosity: string },
) {
  if (
    !Array.isArray(principles) ||
    principles.length > MAX_LOOP_PRINCIPLE_RECORDS
  ) {
    throw new LoopPrincipleError("invalid_state");
  }

  const ids = new Set<string>();
  const orders = new Set<number>();
  let activeCount = 0;
  for (const candidate of principles as readonly unknown[]) {
    if (!isRecord(candidate)) {
      throw new LoopPrincipleError("invalid_state");
    }
    const principle = candidate as LoopPrinciple;
    assertIdentifier(principle.id, "invalid_state");
    assertKind(principle.kind, "invalid_state");
    assertExactText(principle.instruction, "invalid_state");
    if (ids.has(principle.id)) {
      throw new LoopPrincipleError("invalid_state");
    }
    ids.add(principle.id);
    if (
      !Number.isSafeInteger(principle.order) ||
      principle.order < 0 ||
      orders.has(principle.order)
    ) {
      throw new LoopPrincipleError("invalid_state");
    }
    orders.add(principle.order);
    assertPositiveRevision(principle.createdRevision, maximumRevision);
    assertPositiveRevision(principle.updatedRevision, maximumRevision);
    if (principle.createdRevision > principle.updatedRevision) {
      throw new LoopPrincipleError("invalid_state");
    }
    if (
      !Array.isArray(principle.evidence) ||
      principle.evidence.length < 1 ||
      principle.evidence.length > MAX_LOOP_PRINCIPLE_EVIDENCE_ENTRIES
    ) {
      throw new LoopPrincipleError("invalid_state");
    }
    for (const evidence of principle.evidence) {
      validateRecordedEvidence(evidence, principle.updatedRevision, scope);
    }
    if (
      principle.evidence[0]?.recordedRevision !== principle.createdRevision
    ) {
      throw new LoopPrincipleError("invalid_state");
    }

    if (principle.status === "active") {
      activeCount += 1;
      if (
        principle.removedRevision !== null ||
        principle.removedBy !== null ||
        principle.evidence.at(-1)?.recordedRevision !== principle.updatedRevision
      ) {
        throw new LoopPrincipleError("invalid_state");
      }
      continue;
    }
    if (principle.status !== "removed") {
      throw new LoopPrincipleError("invalid_state");
    }
    if (principle.removedRevision === null || principle.removedBy === null) {
      throw new LoopPrincipleError("invalid_state");
    }
    assertPositiveRevision(principle.removedRevision, maximumRevision);
    if (principle.removedRevision !== principle.updatedRevision) {
      throw new LoopPrincipleError("invalid_state");
    }
    validateRecordedEvidence(principle.removedBy, principle.removedRevision, scope);
    if (principle.removedBy.recordedRevision !== principle.removedRevision) {
      throw new LoopPrincipleError("invalid_state");
    }
  }

  if (activeCount > MAX_ACTIVE_LOOP_PRINCIPLES) {
    throw new LoopPrincipleError("invalid_state");
  }
}

function validateRecordedEvidence(
  evidence: LoopPrincipleEvidence,
  maximumRevision: number,
  scope: { loopId: string; originalCuriosity: string },
) {
  validateEvidenceInput(evidence, "invalid_state");
  assertPositiveRevision(evidence.recordedRevision, maximumRevision);
  if (
    evidence.source === "original-curiosity" &&
    (evidence.sourceId !== scope.loopId ||
      evidence.exactText !== scope.originalCuriosity)
  ) {
    throw new LoopPrincipleError("invalid_state");
  }
}

function validateReplay(
  replay: LoopPrincipleRequestReceipt,
  state: LoopPrincipleState,
) {
  if (!isRecord(replay)) {
    throw new LoopPrincipleError("invalid_replay");
  }
  try {
    assertIdentifier(replay.loopId, "invalid_replay");
    assertIdentifier(replay.idempotencyKey, "invalid_replay");
    assertIdentifier(replay.mutationId, "invalid_replay");
    assertFingerprint(replay.requestFingerprint, "invalid_replay");
    assertRevision(replay.resultRevision, "invalid_replay");
  } catch (error) {
    if (error instanceof LoopPrincipleError) throw error;
    throw new LoopPrincipleError("invalid_replay");
  }
  if (
    (replay.requestType !== "apply" && replay.requestType !== "undo") ||
    replay.resultRevision < 1 ||
    replay.resultRevision > state.revision
  ) {
    throw new LoopPrincipleError("invalid_replay");
  }
}

function assertKind(
  value: unknown,
  code: LoopPrincipleErrorCode = "invalid_request",
): asserts value is LoopPrincipleKind {
  if (!LOOP_PRINCIPLE_KINDS.includes(value as LoopPrincipleKind)) {
    throw new LoopPrincipleError(code);
  }
}

function assertIdentifier(value: unknown, code: LoopPrincipleErrorCode) {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new LoopPrincipleError(code);
  }
}

function assertExactText(value: unknown, code: LoopPrincipleErrorCode) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    Array.from(value).length > MAX_LOOP_PRINCIPLE_TEXT_LENGTH
  ) {
    throw new LoopPrincipleError(code);
  }
}

function assertRevision(value: unknown, code: LoopPrincipleErrorCode) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new LoopPrincipleError(code);
  }
}

function assertPositiveRevision(value: unknown, maximumRevision: number) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximumRevision
  ) {
    throw new LoopPrincipleError("invalid_state");
  }
}

function assertFingerprint(value: unknown, code: LoopPrincipleErrorCode) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new LoopPrincipleError(code);
  }
}

function cloneEvidence(evidence: LoopPrincipleEvidence): LoopPrincipleEvidence {
  return { ...evidence };
}

function clonePrinciples(
  principles: readonly LoopPrinciple[],
): LoopPrinciple[] {
  return principles.map((principle) => ({
    ...principle,
    evidence: principle.evidence.map(cloneEvidence),
    removedBy: principle.removedBy ? cloneEvidence(principle.removedBy) : null,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
