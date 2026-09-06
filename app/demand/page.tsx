import { notFound } from "next/navigation";
import { DemandReader } from "@/components/edison/demand-reader";
import "../demand.css";

export const dynamic = "force-dynamic";

export default function DemandPage() {
  if (process.env.EDISON_ON_DEMAND_ENABLED !== "true") notFound();
  return <DemandReader />;
}
