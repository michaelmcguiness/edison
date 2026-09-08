import { notFound } from "next/navigation";
import { DemandReader } from "@/components/edison/demand-reader";
import { requireMemberSession } from "@/lib/member-access";
import "../demand.css";

export const dynamic = "force-dynamic";

export default async function DemandPage() {
  if (process.env.EDISON_ON_DEMAND_ENABLED !== "true") notFound();
  await requireMemberSession("/demand");
  return <DemandReader />;
}
