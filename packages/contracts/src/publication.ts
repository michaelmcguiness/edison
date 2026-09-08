import { z } from "zod";
import { sharedArticleSnapshotSchema } from "./articles";
import { idempotencyKeySchema, uuidSchema } from "./common";

export const publicationSections = ["news", "books", "podcasts"] as const;
export const publicationSectionSchema = z.enum(publicationSections);
export const maxEditorialInstructionsPerSection = 50;

export const editorialDirectionScopeSchema = z.enum([
  "persistent",
  "edition",
]);

export const editorialDirectionOperationSchema = z.enum([
  "create",
  "update",
  "delete",
  "undo",
]);

export const editorialDirectionSectionStateSchema = z
  .object({
    section: publicationSectionSchema,
    revision: z.number().int().nonnegative(),
    currentEditionId: uuidSchema,
  })
  .strict();

export const editorialInstructionSchema = z
  .object({
    id: uuidSchema,
    section: publicationSectionSchema,
    scope: editorialDirectionScopeSchema,
    editionId: uuidSchema.nullable(),
    text: z.string().trim().min(3).max(1000),
    revision: z.number().int().positive(),
    activeForCurrentEdition: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const editorialDirectionResponseSchema = z
  .object({
    sections: z.array(editorialDirectionSectionStateSchema).length(3),
    instructions: z
      .array(editorialInstructionSchema)
      .max(maxEditorialInstructionsPerSection * publicationSections.length),
  })
  .strict()
  .superRefine((value, context) => {
    const sections = new Set(value.sections.map((state) => state.section));
    if (
      sections.size !== publicationSections.length ||
      publicationSections.some((section) => !sections.has(section))
    ) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Direction state must contain each publication section once.",
      });
    }
  });

const mutationBaseSchema = z.object({
  section: publicationSectionSchema,
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
});

const instructionMutationRequestSchema = mutationBaseSchema
  .extend({
    text: z.string().trim().min(3).max(1000),
    scope: editorialDirectionScopeSchema,
    editionId: uuidSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope === "edition" && !value.editionId) {
      context.addIssue({
        code: "custom",
        path: ["editionId"],
        message: "An edition-scoped instruction requires an edition ID.",
      });
    }
    if (value.scope === "persistent" && value.editionId != null) {
      context.addIssue({
        code: "custom",
        path: ["editionId"],
        message: "A persistent instruction cannot target one edition.",
      });
    }
  });

export const createEditorialInstructionRequestSchema =
  instructionMutationRequestSchema.transform((value) => ({
    ...value,
    editionId: value.editionId ?? null,
  }));

export const updateEditorialInstructionRequestSchema =
  instructionMutationRequestSchema.transform((value) => ({
    ...value,
    editionId: value.editionId ?? null,
  }));

export const deleteEditorialInstructionRequestSchema = mutationBaseSchema.strict();

export const undoEditorialDirectionRequestSchema = mutationBaseSchema.strict();

export const editorialDirectionMutationResponseSchema = z
  .object({
    mutationId: uuidSchema,
    operation: editorialDirectionOperationSchema,
    section: publicationSectionSchema,
    previousRevision: z.number().int().nonnegative(),
    resultingRevision: z.number().int().positive(),
    currentRevision: z.number().int().nonnegative(),
    replayed: z.boolean(),
    stillReversible: z.boolean(),
    instructionId: uuidSchema,
    instruction: editorialInstructionSchema.nullable(),
    undoneMutationId: uuidSchema.nullable(),
    contentUpdate: z
      .object({
        status: z.literal("not-requested"),
      })
      .strict(),
  })
  .strict();

export const publicStarterArticleSchema = z
  .object({
    id: uuidSchema,
    position: z.number().int().positive(),
    reason: z.string().min(1).max(500),
    article: sharedArticleSnapshotSchema,
  })
  .strict();

export const publicStarterEditionSchema = z
  .object({
    id: uuidSchema,
    section: z.literal("news"),
    editionDate: z.string().date(),
    label: z.string().min(1).max(120),
    publishedAt: z.string().datetime(),
    itemCount: z.number().int().nonnegative(),
    items: z.array(publicStarterArticleSchema).max(30),
  })
  .strict()
  .superRefine((edition, context) => {
    if (edition.itemCount !== edition.items.length) {
      context.addIssue({
        code: "custom",
        path: ["itemCount"],
        message: "The item count must match the returned starter articles.",
      });
    }
  });

export const publishPublicStarterEditionRequestSchema = z
  .object({
    editionDate: z.string().date(),
    label: z.string().trim().min(1).max(120).default("A place to begin"),
    idempotencyKey: idempotencyKeySchema,
    items: z
      .array(
        z
          .object({
            reason: z.string().trim().min(1).max(500),
            article: sharedArticleSnapshotSchema,
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export type PublicationSection = z.infer<typeof publicationSectionSchema>;
export type EditorialDirectionScope = z.infer<
  typeof editorialDirectionScopeSchema
>;
export type EditorialDirectionSectionState = z.infer<
  typeof editorialDirectionSectionStateSchema
>;
export type EditorialInstruction = z.infer<
  typeof editorialInstructionSchema
>;
export type EditorialDirectionResponse = z.infer<
  typeof editorialDirectionResponseSchema
>;
export type CreateEditorialInstructionRequest = z.infer<
  typeof createEditorialInstructionRequestSchema
>;
export type UpdateEditorialInstructionRequest = z.infer<
  typeof updateEditorialInstructionRequestSchema
>;
export type DeleteEditorialInstructionRequest = z.infer<
  typeof deleteEditorialInstructionRequestSchema
>;
export type UndoEditorialDirectionRequest = z.infer<
  typeof undoEditorialDirectionRequestSchema
>;
export type EditorialDirectionMutationResponse = z.infer<
  typeof editorialDirectionMutationResponseSchema
>;
export type PublicStarterArticle = z.infer<typeof publicStarterArticleSchema>;
export type PublicStarterEdition = z.infer<typeof publicStarterEditionSchema>;
export type PublishPublicStarterEditionRequest = z.infer<
  typeof publishPublicStarterEditionRequestSchema
>;
