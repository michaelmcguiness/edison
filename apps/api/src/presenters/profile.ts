import type { feedPreferences, profiles, userInterests } from "@edison/db";
import { presentExplicitInterests } from "./interest";

const configurableCategories = [
  "tech-science",
  "business",
  "arts-culture",
  "sports",
  "entertainment",
] as const;

export function presentProfile(
  profile: typeof profiles.$inferSelect,
  preferences: typeof feedPreferences.$inferSelect,
  interests: Array<typeof userInterests.$inferSelect> = [],
) {
  const visibility = preferences.categoryVisibility ?? {};
  const order = preferences.categoryOrder ?? [];
  const ordered = [...configurableCategories].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
  });

  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName || profile.email.split("@")[0] || "Reader",
    onboardingComplete: profile.onboardingComplete,
    currentStreak: profile.currentStreak,
    lastReadDate: profile.lastReadDate,
    timezone: profile.timezone,
    preferences: {
      articleLength: preferences.articleLength,
      editorialBrief: preferences.editorialBrief,
      depth: preferences.depth,
      novelty: preferences.novelty,
      categories: ordered.map((category, position) => ({
        category,
        position,
        visible: visibility[category] !== false,
      })),
      explicitInterests: presentExplicitInterests(interests),
      inferredPreferences: Array.isArray(preferences.inferredPreferences)
        ? preferences.inferredPreferences
        : [],
      knowledgeState: Array.isArray(preferences.knowledgeState)
        ? preferences.knowledgeState
        : [],
    },
  };
}
