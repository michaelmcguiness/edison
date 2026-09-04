import { and, eq, inArray } from "drizzle-orm";
import { onboardingRequestSchema, profileSchema } from "@edison/contracts";
import { feedPreferences, profiles, userInterests } from "@edison/db";
import { apiHandler, json } from "../../../src/http/api-handler";
import { HttpError } from "../../../src/http/errors";
import { presentProfile } from "../../../src/presenters/profile";
import { withActiveMember } from "../../../src/services/members";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const input = onboardingRequestSchema.parse(await request.json());

    return withActiveMember(claims, async ({ transaction }) => {
      const [profile] = await transaction
        .update(profiles)
        .set({
          displayName: input.displayName,
          onboardingComplete: true,
          timezone: input.timezone,
        })
        .where(eq(profiles.id, claims.sub))
        .returning();

      const [preferences] = await transaction
        .update(feedPreferences)
        .set({
          articleLength: input.articleLength,
          editorialBrief: input.goals,
        })
        .where(eq(feedPreferences.userId, claims.sub))
        .returning();

      if (!profile || !preferences) {
        throw new HttpError(
          500,
          "onboarding_failed",
          "Edison could not save the reader profile.",
        );
      }

      const interests = await transaction
        .select()
        .from(userInterests)
        .where(
          and(
            eq(userInterests.userId, claims.sub),
            eq(userInterests.kind, "explicit"),
            inArray(userInterests.status, ["active", "muted"]),
          ),
        );

      return json(
        profileSchema.parse(presentProfile(profile, preferences, interests)),
      );
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
