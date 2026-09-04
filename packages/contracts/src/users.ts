import { z } from "zod";
import {
  articleCategories,
  articleCategorySchema,
  uuidSchema,
} from "./common";

export const articleLengthSchema = z.enum(["brief", "standard", "deep"]);

export const explicitInterestStatusSchema = z.enum(["active", "muted"]);

export const interestTopicSchema = z.string().trim().min(1).max(200);

export const explicitInterestSchema = z.object({
  id: uuidSchema,
  topic: interestTopicSchema,
  status: explicitInterestStatusSchema,
});

export const explicitInterestsResponseSchema = z.object({
  items: z.array(explicitInterestSchema),
});

export const createExplicitInterestRequestSchema = z.object({
  topic: interestTopicSchema,
}).strict();

export const updateExplicitInterestRequestSchema = z.object({
  status: explicitInterestStatusSchema,
}).strict();

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Timezone must be a recognized IANA timezone.");

export const categorySettingSchema = z.object({
  category: articleCategorySchema,
  visible: z.boolean(),
  position: z.number().int().min(0).max(articleCategories.length - 1),
});

export const categorySettingsSchema = z
  .array(categorySettingSchema)
  .length(articleCategories.length)
  .superRefine((settings, context) => {
    const categories = new Set(settings.map((setting) => setting.category));
    if (
      categories.size !== articleCategories.length ||
      articleCategories.some((category) => !categories.has(category))
    ) {
      context.addIssue({
        code: "custom",
        message: "Categories must contain each configurable section exactly once.",
      });
    }

    if (new Set(settings.map((setting) => setting.position)).size !== settings.length) {
      context.addIssue({
        code: "custom",
        message: "Category positions must be unique.",
      });
    }

    if (!settings.some((setting) => setting.visible)) {
      context.addIssue({
        code: "custom",
        message: "At least one category must remain visible.",
      });
    }
  });

export const preferencesSchema = z.object({
  articleLength: articleLengthSchema,
  editorialBrief: z.string(),
  depth: z.number().int().min(0).max(100),
  novelty: z.number().int().min(0).max(100),
  categories: categorySettingsSchema,
  explicitInterests: z.array(explicitInterestSchema),
  inferredPreferences: z.array(z.string()),
  knowledgeState: z.array(
    z.object({
      topic: z.string(),
      level: z.enum(["new", "beginner", "intermediate", "advanced"]),
      note: z.string().nullable(),
    }),
  ),
});

export const profileSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  onboardingComplete: z.boolean(),
  currentStreak: z.number().int().nonnegative(),
  lastReadDate: z.string().date().nullable(),
  timezone: timeZoneSchema,
  preferences: preferencesSchema,
});

export const onboardingRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  goals: z.string().trim().min(10).max(2000),
  articleLength: articleLengthSchema,
  timezone: timeZoneSchema,
});

export const updatePreferencesRequestSchema = preferencesSchema
  .pick({ articleLength: true, depth: true, novelty: true, categories: true })
  .partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one supported preference must be provided.",
  });

export type Profile = z.infer<typeof profileSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>;
export type ArticleLength = z.infer<typeof articleLengthSchema>;
export type ExplicitInterest = z.infer<typeof explicitInterestSchema>;
export type ExplicitInterestStatus = z.infer<
  typeof explicitInterestStatusSchema
>;
export type ExplicitInterestsResponse = z.infer<
  typeof explicitInterestsResponseSchema
>;
