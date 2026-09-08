import { getContext } from "@vercel/oidc";
import { proxyDemandRequest } from "@/lib/demand-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyDemandRequest(request, path.join("/"), {
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    enabled: process.env.EDISON_ON_DEMAND_ENABLED === "true",
    production: process.env.NODE_ENV === "production",
    ...(process.env.EDISON_DEMAND_TRUSTED_SOURCE_ENABLED === "true" ? {
      trustedSource: {
        apiUrl: process.env.EDISON_DEMAND_PROTECTED_API_URL,
        getToken: async () => {
          // Read only Vercel's server request context. The async token helper
          // refreshes through credential storage/CLI; neither that helper nor
          // its environment fallback belongs in this request-only connector.
          if (process.env.VERCEL !== "1") throw new Error("vercel_runtime_required");
          const token = getContext().headers?.["x-vercel-oidc-token"];
          if (!token) throw new Error("vercel_request_identity_required");
          return token;
        },
      },
    } : {}),
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
