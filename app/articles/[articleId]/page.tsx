import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { uuidSchema } from "@edison/contracts";
import { DemandReader } from "@/components/edison/demand-reader";
import { getWebAppMode } from "@/lib/app-mode";
import { requireMemberSession } from "@/lib/member-access";
import "../../demand.css";

export const dynamic = "force-dynamic";
// Private titles are never fetched for an anonymous link preview.
export const metadata: Metadata = { title: "Your reading — Edison", robots: { index: false, follow: false } };

export default async function ArticlePage({ params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params;
  if (!uuidSchema.safeParse(articleId).success || getWebAppMode() !== "live" || process.env.EDISON_ON_DEMAND_ENABLED !== "true") notFound();
  await requireMemberSession(`/articles/${articleId}`);
  return <DemandReader initialArticleId={articleId} />;
}
