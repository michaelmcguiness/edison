import "server-only";

import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  editorialDirectionMutationResponseSchema,
  editorialDirectionResponseSchema,
  editorialInstructionSchema,
  maxEditorialInstructionsPerSection,
  publicationSections,
  type CreateEditorialInstructionRequest,
  type DeleteEditorialInstructionRequest,
  type EditorialDirectionMutationResponse,
  type EditorialDirectionScope,
  type PublicationSection,
  type UndoEditorialDirectionRequest,
  type UpdateEditorialInstructionRequest,
} from "@edison/contracts";
import {
  editorialDirectionMutations,
  editorialDirectionStates,
  editorialInstructions,
  type UserTransaction,
  type VerifiedUserClaims,
} from "@edison/db";
import { HttpError } from "../http/errors";
import { withActiveMember } from "./members";
import { fingerprintRequest } from "./request-fingerprint";

type InstructionRow = typeof editorialInstructions.$inferSelect;
type MutationRow = typeof editorialDirectionMutations.$inferSelect;
type DirectionStateRow = typeof editorialDirectionStates.$inferSelect;

const storedInstructionSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    section: z.enum(publicationSections),
    scope: z.enum(["persistent", "edition"]),
    editionId: z.string().uuid().nullable(),
    text: z.string().trim().min(3).max(1000),
    revision: z.number().int().positive(),
    deletedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

type StoredInstructionSnapshot = z.infer<
  typeof storedInstructionSnapshotSchema
>;

function instructionSnapshot(row: InstructionRow): StoredInstructionSnapshot {
  return storedInstructionSnapshotSchema.parse({
    id: row.id,
    section: row.section,
    scope: row.scope,
    editionId: row.editionId,
    text: row.text,
    revision: row.revision,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function presentInstruction(
  snapshot: StoredInstructionSnapshot,
  currentEditionId: string,
) {
  if (snapshot.deletedAt) return null;
  return editorialInstructionSchema.parse({
    id: snapshot.id,
    section: snapshot.section,
    scope: snapshot.scope,
    editionId: snapshot.editionId,
    text: snapshot.text,
    revision: snapshot.revision,
    activeForCurrentEdition:
      snapshot.scope === "persistent" ||
      snapshot.editionId === currentEditionId,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  });
}

function requireSnapshot(value: unknown, field: string) {
  const parsed = storedInstructionSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      500,
      "editorial_direction_history_invalid",
      `The stored ${field} editorial-direction snapshot is invalid.`,
    );
  }
  return parsed.data;
}

async function findMutationByIdempotencyKey(
  transaction: UserTransaction,
  userId: string,
  idempotencyKey: string,
) {
  const [mutation] = await transaction
    .select()
    .from(editorialDirectionMutations)
    .where(
      and(
        eq(editorialDirectionMutations.userId, userId),
        eq(editorialDirectionMutations.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return mutation;
}

async function requireDirectionState(
  transaction: UserTransaction,
  userId: string,
  section: PublicationSection,
  lock = false,
) {
  const query = transaction
    .select()
    .from(editorialDirectionStates)
    .where(
      and(
        eq(editorialDirectionStates.userId, userId),
        eq(editorialDirectionStates.section, section),
      ),
    )
    .limit(1);
  const rows = lock ? await query.for("update") : await query;
  const state = rows[0];
  if (!state) {
    throw new HttpError(
      500,
      "editorial_direction_state_missing",
      "The reader's editorial-direction state is incomplete.",
    );
  }
  return state;
}

function assertExpectedRevision(
  state: DirectionStateRow,
  expectedRevision: number,
) {
  if (state.revision !== expectedRevision) {
    throw new HttpError(
      409,
      "editorial_direction_revision_conflict",
      "The editorial direction changed before this edit was saved.",
      {
        section: state.section,
        expectedRevision,
        currentRevision: state.revision,
      },
    );
  }
}

function assertEditionScope(
  state: DirectionStateRow,
  scope: EditorialDirectionScope,
  editionId: string | null,
) {
  if (scope === "edition" && editionId !== state.currentEditionId) {
    throw new HttpError(
      409,
      "editorial_direction_edition_changed",
      "That edition is no longer the current edition for this section.",
      {
        section: state.section,
        requestedEditionId: editionId,
        currentEditionId: state.currentEditionId,
      },
    );
  }
  if (scope === "persistent" && editionId !== null) {
    throw new HttpError(
      400,
      "invalid_editorial_direction_scope",
      "A persistent instruction cannot target one edition.",
    );
  }
}

function assertIdempotencyMatch(mutation: MutationRow, fingerprint: string) {
  if (mutation.requestFingerprint !== fingerprint) {
    throw new HttpError(
      409,
      "idempotency_key_reused",
      "That idempotency key was already used for a different editorial-direction edit.",
    );
  }
}

function presentMutation(
  mutation: MutationRow,
  state: DirectionStateRow,
  replayed: boolean,
): EditorialDirectionMutationResponse {
  const after = requireSnapshot(mutation.afterSnapshot, "result");
  return editorialDirectionMutationResponseSchema.parse({
    mutationId: mutation.id,
    operation: mutation.operation,
    section: mutation.section,
    previousRevision: mutation.baseRevision,
    resultingRevision: mutation.resultingRevision,
    currentRevision: state.revision,
    replayed,
    stillReversible:
      mutation.operation !== "undo" &&
      mutation.revertedByMutationId === null &&
      state.revision === mutation.resultingRevision,
    instructionId: mutation.instructionId,
    instruction: presentInstruction(after, state.currentEditionId),
    undoneMutationId: mutation.undoOfMutationId,
    contentUpdate: { status: "not-requested" },
  });
}

async function replayIfPresent(
  transaction: UserTransaction,
  claims: VerifiedUserClaims,
  section: PublicationSection,
  idempotencyKey: string,
  fingerprint: string,
) {
  const mutation = await findMutationByIdempotencyKey(
    transaction,
    claims.sub,
    idempotencyKey,
  );
  if (!mutation) return null;
  assertIdempotencyMatch(mutation, fingerprint);
  const state = await requireDirectionState(
    transaction,
    claims.sub,
    section,
  );
  return presentMutation(mutation, state, true);
}

async function advanceRevision(
  transaction: UserTransaction,
  state: DirectionStateRow,
) {
  const nextRevision = state.revision + 1;
  const [updated] = await transaction
    .update(editorialDirectionStates)
    .set({ revision: nextRevision })
    .where(
      and(
        eq(editorialDirectionStates.userId, state.userId),
        eq(editorialDirectionStates.section, state.section),
        eq(editorialDirectionStates.revision, state.revision),
      ),
    )
    .returning();
  if (!updated) {
    throw new HttpError(
      409,
      "editorial_direction_revision_conflict",
      "The editorial direction changed before this edit was saved.",
    );
  }
  return updated;
}

export async function listEditorialDirections(claims: VerifiedUserClaims) {
  return withActiveMember(claims, async ({ transaction }) => {
    const states = await transaction
      .select()
      .from(editorialDirectionStates)
      .where(eq(editorialDirectionStates.userId, claims.sub));
    if (states.length !== publicationSections.length) {
      throw new HttpError(
        500,
        "editorial_direction_state_missing",
        "The reader's editorial-direction state is incomplete.",
      );
    }

    const stateBySection = new Map(states.map((state) => [state.section, state]));
    const rows = await transaction
      .select()
      .from(editorialInstructions)
      .where(
        and(
          eq(editorialInstructions.userId, claims.sub),
          isNull(editorialInstructions.deletedAt),
        ),
      )
      .orderBy(
        asc(editorialInstructions.revision),
        asc(editorialInstructions.id),
      )
      .limit(
        maxEditorialInstructionsPerSection * publicationSections.length + 1,
      );
    const instructionCountBySection = new Map<PublicationSection, number>();
    for (const row of rows) {
      instructionCountBySection.set(
        row.section,
        (instructionCountBySection.get(row.section) ?? 0) + 1,
      );
    }
    if (
      rows.length >
        maxEditorialInstructionsPerSection * publicationSections.length ||
      publicationSections.some(
        (section) =>
          (instructionCountBySection.get(section) ?? 0) >
          maxEditorialInstructionsPerSection,
      )
    ) {
      throw new HttpError(
        500,
        "editorial_direction_limit_invalid",
        "The reader's editorial direction exceeds its safe instruction limit.",
      );
    }

    return editorialDirectionResponseSchema.parse({
      sections: publicationSections.map((section) => {
        const state = stateBySection.get(section)!;
        return {
          section,
          revision: state.revision,
          currentEditionId: state.currentEditionId,
        };
      }),
      instructions: rows.map((row) =>
        presentInstruction(
          instructionSnapshot(row),
          stateBySection.get(row.section)!.currentEditionId,
        ),
      ),
    });
  });
}

export async function createEditorialInstruction(
  claims: VerifiedUserClaims,
  input: CreateEditorialInstructionRequest,
) {
  const fingerprint = fingerprintRequest([
    "create",
    input.section,
    input.text,
    input.scope,
    input.editionId,
    input.expectedRevision,
  ]);

  return withActiveMember(claims, async ({ transaction }) => {
    const replay = await replayIfPresent(
      transaction,
      claims,
      input.section,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay) return replay;

    const state = await requireDirectionState(
      transaction,
      claims.sub,
      input.section,
      true,
    );
    const replayAfterLock = await replayIfPresent(
      transaction,
      claims,
      input.section,
      input.idempotencyKey,
      fingerprint,
    );
    if (replayAfterLock) return replayAfterLock;
    assertExpectedRevision(state, input.expectedRevision);
    assertEditionScope(state, input.scope, input.editionId);

    // Every create for this reader/section first locks the same direction-state
    // row, so counting and insertion are atomic even under concurrent requests.
    const [{ value: activeInstructionCount }] = await transaction
      .select({ value: count() })
      .from(editorialInstructions)
      .where(
        and(
          eq(editorialInstructions.userId, claims.sub),
          eq(editorialInstructions.section, input.section),
          isNull(editorialInstructions.deletedAt),
        ),
      );
    if (activeInstructionCount >= maxEditorialInstructionsPerSection) {
      throw new HttpError(
        409,
        "editorial_direction_limit_reached",
        `You can keep ${maxEditorialInstructionsPerSection} instructions per section. Remove an older instruction first.`,
      );
    }

    const nextRevision = state.revision + 1;
    const now = new Date();
    const instructionId = crypto.randomUUID();
    const [instruction] = await transaction
      .insert(editorialInstructions)
      .values({
        id: instructionId,
        userId: claims.sub,
        section: input.section,
        scope: input.scope,
        editionId: input.editionId,
        text: input.text,
        revision: nextRevision,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!instruction) {
      throw new HttpError(
        500,
        "editorial_instruction_creation_failed",
        "The editorial instruction could not be saved.",
      );
    }

    const [mutation] = await transaction
      .insert(editorialDirectionMutations)
      .values({
        userId: claims.sub,
        section: input.section,
        operation: "create",
        instructionId,
        baseRevision: state.revision,
        resultingRevision: nextRevision,
        beforeSnapshot: null,
        afterSnapshot: instructionSnapshot(instruction),
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
      })
      .onConflictDoNothing()
      .returning();
    if (!mutation) {
      throw new HttpError(
        409,
        "idempotency_key_reused",
        "That idempotency key was used by a concurrent editorial-direction edit.",
      );
    }
    const updatedState = await advanceRevision(transaction, state);
    return presentMutation(mutation, updatedState, false);
  });
}

async function requireOwnedInstruction(
  transaction: UserTransaction,
  userId: string,
  section: PublicationSection,
  instructionId: string,
) {
  const [instruction] = await transaction
    .select()
    .from(editorialInstructions)
    .where(
      and(
        eq(editorialInstructions.id, instructionId),
        eq(editorialInstructions.userId, userId),
        eq(editorialInstructions.section, section),
      ),
    )
    .limit(1);
  if (!instruction || instruction.deletedAt) {
    throw new HttpError(
      404,
      "editorial_instruction_not_found",
      "That editorial instruction was not found.",
    );
  }
  return instruction;
}

export async function updateEditorialInstruction(
  claims: VerifiedUserClaims,
  instructionId: string,
  input: UpdateEditorialInstructionRequest,
) {
  const fingerprint = fingerprintRequest([
    "update",
    input.section,
    instructionId,
    input.text,
    input.scope,
    input.editionId,
    input.expectedRevision,
  ]);

  return withActiveMember(claims, async ({ transaction }) => {
    const replay = await replayIfPresent(
      transaction,
      claims,
      input.section,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay) return replay;
    const state = await requireDirectionState(
      transaction,
      claims.sub,
      input.section,
      true,
    );
    const replayAfterLock = await replayIfPresent(
      transaction,
      claims,
      input.section,
      input.idempotencyKey,
      fingerprint,
    );
    if (replayAfterLock) return replayAfterLock;
    assertExpectedRevision(state, input.expectedRevision);
    assertEditionScope(state, input.scope, input.editionId);

    const current = await requireOwnedInstruction(
      transaction,
      claims.sub,
      input.section,
      instructionId,
    );
    const nextRevision = state.revision + 1;
    const [updated] = await transaction
      .update(editorialInstructions)
      .set({
        text: input.text,
        scope: input.scope,
        editionId: input.editionId,
        revision: nextRevision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(editorialInstructions.id, instructionId),
          eq(editorialInstructions.userId, claims.sub),
          eq(editorialInstructions.section, input.section),
          isNull(editorialInstructions.deletedAt),
        ),
      )
      .returning();
    if (!updated) {
      throw new HttpError(
        409,
        "editorial_instruction_changed",
        "That editorial instruction changed before this edit was saved.",
      );
    }
    const [mutation] = await transaction
      .insert(editorialDirectionMutations)
      .values({
        userId: claims.sub,
        section: input.section,
        operation: "update",
        instructionId,
        baseRevision: state.revision,
        resultingRevision: nextRevision,
        beforeSnapshot: instructionSnapshot(current),
        afterSnapshot: instructionSnapshot(updated),
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
      })
      .onConflictDoNothing()
      .returning();
    if (!mutation) {
      throw new HttpError(
        409,
        "idempotency_key_reused",
        "That idempotency key was used by a concurrent editorial-direction edit.",
      );
    }
    const updatedState = await advanceRevision(transaction, state);
    return presentMutation(mutation, updatedState, false);
  });
}

export async function deleteEditorialInstruction(
  claims: VerifiedUserClaims,
  instructionId: string,
  input: DeleteEditorialInstructionRequest,
) {
  const fingerprint = fingerprintRequest([
    "delete",
    input.section,
    instructionId,
    input.expectedRevision,
  ]);

  return withActiveMember(claims, async ({ transaction }) => {
    const replay = await replayIfPresent(
      transaction,
      claims,
      input.section,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay) return replay;
    const state = await requireDirectionState(
      transaction,
      claims.sub,
      input.section,
      true,
    );
    const replayAfterLock = await replayIfPresent(
      transaction,
      claims,
      input.section,
      input.idempotencyKey,
      fingerprint,
    );
    if (replayAfterLock) return replayAfterLock;
    assertExpectedRevision(state, input.expectedRevision);

    const current = await requireOwnedInstruction(
      transaction,
      claims.sub,
      input.section,
      instructionId,
    );
    const nextRevision = state.revision + 1;
    const [deleted] = await transaction
      .update(editorialInstructions)
      .set({
        deletedAt: new Date(),
        revision: nextRevision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(editorialInstructions.id, instructionId),
          eq(editorialInstructions.userId, claims.sub),
          eq(editorialInstructions.section, input.section),
          isNull(editorialInstructions.deletedAt),
        ),
      )
      .returning();
    if (!deleted) {
      throw new HttpError(
        409,
        "editorial_instruction_changed",
        "That editorial instruction changed before this deletion was saved.",
      );
    }
    const [mutation] = await transaction
      .insert(editorialDirectionMutations)
      .values({
        userId: claims.sub,
        section: input.section,
        operation: "delete",
        instructionId,
        baseRevision: state.revision,
        resultingRevision: nextRevision,
        beforeSnapshot: instructionSnapshot(current),
        afterSnapshot: instructionSnapshot(deleted),
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
      })
      .onConflictDoNothing()
      .returning();
    if (!mutation) {
      throw new HttpError(
        409,
        "idempotency_key_reused",
        "That idempotency key was used by a concurrent editorial-direction edit.",
      );
    }
    const updatedState = await advanceRevision(transaction, state);
    return presentMutation(mutation, updatedState, false);
  });
}

export async function undoEditorialDirectionMutation(
  claims: VerifiedUserClaims,
  mutationId: string,
  input: UndoEditorialDirectionRequest,
) {
  const fingerprint = fingerprintRequest([
    "undo",
    input.section,
    mutationId,
    input.expectedRevision,
  ]);

  return withActiveMember(claims, async ({ transaction }) => {
    const replay = await replayIfPresent(
      transaction,
      claims,
      input.section,
      input.idempotencyKey,
      fingerprint,
    );
    if (replay) return replay;
    const state = await requireDirectionState(
      transaction,
      claims.sub,
      input.section,
      true,
    );
    const replayAfterLock = await replayIfPresent(
      transaction,
      claims,
      input.section,
      input.idempotencyKey,
      fingerprint,
    );
    if (replayAfterLock) return replayAfterLock;
    assertExpectedRevision(state, input.expectedRevision);

    const [sourceMutation] = await transaction
      .select()
      .from(editorialDirectionMutations)
      .where(
        and(
          eq(editorialDirectionMutations.id, mutationId),
          eq(editorialDirectionMutations.userId, claims.sub),
          eq(editorialDirectionMutations.section, input.section),
        ),
      )
      .limit(1);
    if (!sourceMutation || sourceMutation.operation === "undo") {
      throw new HttpError(
        404,
        "editorial_direction_mutation_not_found",
        "That editorial-direction change was not found.",
      );
    }
    if (sourceMutation.revertedByMutationId) {
      throw new HttpError(
        409,
        "editorial_direction_already_undone",
        "That editorial-direction change has already been undone.",
      );
    }
    if (sourceMutation.resultingRevision !== state.revision) {
      throw new HttpError(
        409,
        "editorial_direction_undo_conflict",
        "The editorial direction has changed since this edit. Review it to make another change.",
        {
          section: input.section,
          mutationRevision: sourceMutation.resultingRevision,
          currentRevision: state.revision,
        },
      );
    }

    const [current] = await transaction
      .select()
      .from(editorialInstructions)
      .where(
        and(
          eq(editorialInstructions.id, sourceMutation.instructionId),
          eq(editorialInstructions.userId, claims.sub),
          eq(editorialInstructions.section, input.section),
        ),
      )
      .limit(1);
    if (!current) {
      throw new HttpError(
        409,
        "editorial_direction_history_incomplete",
        "That editorial-direction change can no longer be safely undone.",
      );
    }
    const expectedCurrent = requireSnapshot(
      sourceMutation.afterSnapshot,
      "current",
    );
    const actualCurrent = instructionSnapshot(current);
    if (JSON.stringify(actualCurrent) !== JSON.stringify(expectedCurrent)) {
      throw new HttpError(
        409,
        "editorial_direction_undo_conflict",
        "The instruction changed since this edit and cannot be safely undone.",
      );
    }

    const nextRevision = state.revision + 1;
    const previous = sourceMutation.beforeSnapshot
      ? requireSnapshot(sourceMutation.beforeSnapshot, "previous")
      : null;
    const [restored] = await transaction
      .update(editorialInstructions)
      .set(
        previous
          ? {
              scope: previous.scope,
              editionId: previous.editionId,
              text: previous.text,
              deletedAt: previous.deletedAt
                ? new Date(previous.deletedAt)
                : null,
              revision: nextRevision,
              updatedAt: new Date(),
            }
          : {
              deletedAt: new Date(),
              revision: nextRevision,
              updatedAt: new Date(),
            },
      )
      .where(
        and(
          eq(editorialInstructions.id, sourceMutation.instructionId),
          eq(editorialInstructions.userId, claims.sub),
          eq(editorialInstructions.section, input.section),
        ),
      )
      .returning();
    if (!restored) {
      throw new HttpError(
        409,
        "editorial_direction_undo_conflict",
        "That editorial-direction change can no longer be safely undone.",
      );
    }

    const undoMutationId = crypto.randomUUID();
    const [undoMutation] = await transaction
      .insert(editorialDirectionMutations)
      .values({
        id: undoMutationId,
        userId: claims.sub,
        section: input.section,
        operation: "undo",
        instructionId: sourceMutation.instructionId,
        baseRevision: state.revision,
        resultingRevision: nextRevision,
        beforeSnapshot: actualCurrent,
        afterSnapshot: instructionSnapshot(restored),
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        undoOfMutationId: sourceMutation.id,
      })
      .onConflictDoNothing()
      .returning();
    if (!undoMutation) {
      throw new HttpError(
        409,
        "editorial_direction_undo_conflict",
        "That editorial-direction change was concurrently updated.",
      );
    }
    const [marked] = await transaction
      .update(editorialDirectionMutations)
      .set({ revertedByMutationId: undoMutation.id })
      .where(
        and(
          eq(editorialDirectionMutations.id, sourceMutation.id),
          eq(editorialDirectionMutations.userId, claims.sub),
          isNull(editorialDirectionMutations.revertedByMutationId),
        ),
      )
      .returning({ id: editorialDirectionMutations.id });
    if (!marked) {
      throw new HttpError(
        409,
        "editorial_direction_already_undone",
        "That editorial-direction change has already been undone.",
      );
    }
    const updatedState = await advanceRevision(transaction, state);
    return presentMutation(undoMutation, updatedState, false);
  });
}
