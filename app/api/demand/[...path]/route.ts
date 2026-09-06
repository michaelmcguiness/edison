import { proxyDemandRequest } from "@/lib/demand-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyDemandRequest(request, path.join("/"), {
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    enabled: process.env.EDISON_ON_DEMAND_ENABLED === "true",
    production: process.env.NODE_ENV === "production",
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
