import { z } from "zod";
import { articleCategorySchema, idempotencyKeySchema, uuidSchema } from "./common";

export const maxLearningLoops = 30;
export const maxLoopPublicArticles = 30;
export const maxLoopArticleCards = 30;
export const maxLoopDirectionHistory = 20;

export const learningLoopTitleSchema = z.string().trim().min(1).max(120);
export const learningLoopCuriositySchema = z.string().trim().min(1).max(500);
export const learningLoopDirectionSchema = z.string().trim().max(1000);

export const learningLoopDirectionMutationSchema = z
  .object({
    id: uuidSchema,
    operation: z.enum(["set", "undo"]),
    previousDirection: learningLoopDirectionSchema,
    resultingDirection: learningLoopDirectionSchema,
    previousRevision: z.number().int().nonnegative(),
    resultingRevision: z.number().int().positive(),
    undoneMutationId: uuidSchema.nullable(),
    stillReversible: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const learningLoopSchema = z
  .object({
    id: uuidSchema,
    title: learningLoopTitleSchema,
    originalCuriosity: learningLoopCuriositySchema,
    direction: learningLoopDirectionSchema,
    revision: z.number().int().nonnegative(),
    paused: z.boolean(),
    lastMutationId: uuidSchema.nullable(),
    directionHistory: z
      .array(learningLoopDirectionMutationSchema)
      .max(maxLoopDirectionHistory),
    articleIds: z.array(uuidSchema).max(maxLoopArticleCards),
    publicArticleIds: z.array(uuidSchema).max(maxLoopPublicArticles),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const learningLoopsResponseSchema = z
  .object({
    loops: z.array(learningLoopSchema).max(maxLearningLoops),
  })
  .strict();

export const createLearningLoopRequestSchema = z
  .object({
    title: learningLoopTitleSchema,
    originalCuriosity: learningLoopCuriositySchema,
    publicArticleIds: z.array(uuidSchema).max(maxLoopPublicArticles).default([]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.publicArticleIds).size !== value.publicArticleIds.length) {
      context.addIssue({
        code: "custom",
        path: ["publicArticleIds"],
        message: "Public article IDs must be unique.",
      });
    }
  });

export const learningLoopResponseSchema = z
  .object({
    loop: learningLoopSchema,
    replayed: z.boolean(),
  })
  .strict();

const loopDirectionMutationBaseSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
});

export const learningLoopDirectionRequestSchema = z.discriminatedUnion(
  "operation",
  [
    loopDirectionMutationBaseSchema
      .extend({
        operation: z.literal("set"),
        direction: learningLoopDirectionSchema,
      })
      .strict(),
    loopDirectionMutationBaseSchema
      .extend({
        operation: z.literal("undo"),
        mutationId: uuidSchema,
      })
      .strict(),
  ],
);

export const learningLoopMutationResponseSchema = z
  .object({
    loop: learningLoopSchema,
    mutationId: uuidSchema,
    operation: z.enum(["set", "undo"]),
    previousRevision: z.number().int().nonnegative(),
    resultingRevision: z.number().int().positive(),
    replayed: z.boolean(),
    stillReversible: z.boolean(),
    undoneMutationId: uuidSchema.nullable(),
  })
  .strict();

export const learningLoopArticleCardSchema = z
  .object({
    id: uuidSchema,
    visibility: z.enum(["private", "public"]),
    slug: z.string().min(1).nullable(),
    category: articleCategorySchema,
    kicker: z.string().min(1),
    title: z.string().min(1),
    deck: z.string().min(1),
    readingMinutes: z.number().int().positive(),
    sourceCount: z.number().int().nonnegative(),
    researchedAt: z.string().datetime(),
    reason: z.string().min(1),
    summary: z.array(z.string().min(1)).length(3),
    saved: z.boolean(),
    completed: z.boolean(),
  })
  .strict();

export const learningLoopArticlesQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(maxLoopArticleCards)
      .default(maxLoopArticleCards),
  })
  .strict();

export const learningLoopArticlesResponseSchema = z
  .object({
    loopId: uuidSchema,
    items: z.array(learningLoopArticleCardSchema).max(maxLoopArticleCards),
    itemCount: z.number().int().nonnegative().max(maxLoopArticleCards),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.itemCount !== value.items.length) {
      context.addIssue({
        code: "custom",
        path: ["itemCount"],
        message: "The item count must match the returned loop articles.",
      });
    }
  });

export type LearningLoop = z.infer<typeof learningLoopSchema>;
export type LearningLoopsResponse = z.infer<typeof learningLoopsResponseSchema>;
export type CreateLearningLoopRequest = z.infer<
  typeof createLearningLoopRequestSchema
>;
export type LearningLoopResponse = z.infer<typeof learningLoopResponseSchema>;
export type LearningLoopDirectionRequest = z.infer<
  typeof learningLoopDirectionRequestSchema
>;
export type LearningLoopMutationResponse = z.infer<
  typeof learningLoopMutationResponseSchema
>;
export type LearningLoopArticleCard = z.infer<
  typeof learningLoopArticleCardSchema
>;
export type LearningLoopArticlesResponse = z.infer<
  typeof learningLoopArticlesResponseSchema
>;
