import { sql } from "drizzle-orm";
import {
  publicArticleShareSchema,
  sharedArticleSnapshotSchema,
  shareSlugSchema,
  uuidSchema,
} from "@edison/contracts";
import { withPublicDb } from "@edison/db";
import { z } from "zod";
import {
  json,
  publicApiHandler,
} from "../../../../src/http/api-handler";
import { HttpError } from "../../../../src/http/errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

const publicShareRowSchema = z.object({
  id: uuidSchema,
  slug: shareSlugSchema,
  snapshot: z.unknown(),
  createdAt: z.preprocess(
    (value) => (typeof value === "string" ? new Date(value) : value),
    z.date(),
  ),
});

export async function GET(request: Request, context: RouteContext) {
  return publicApiHandler(request, async () => {
    const { slug: rawSlug } = await context.params;
    const slug = shareSlugSchema.parse(rawSlug);

    const [rawShare] = await withPublicDb((transaction) =>
      transaction.execute(sql`
        select
          id,
          slug,
          snapshot,
          created_at as "createdAt"
        from edison_public_api.read_article_share(${slug})
      `),
    );

    if (!rawShare) {
      throw new HttpError(404, "share_not_found", "That article share was not found.");
    }
    const share = publicShareRowSchema.parse(rawShare);

    return json(
      publicArticleShareSchema.parse({
        shareId: share.id,
        slug: share.slug,
        createdAt: share.createdAt.toISOString(),
        article: sharedArticleSnapshotSchema.parse(share.snapshot),
      }),
    );
  });
}

export async function OPTIONS(request: Request) {
  return publicApiHandler(request, async () =>
    new Response(null, { status: 204 }),
  );
}
