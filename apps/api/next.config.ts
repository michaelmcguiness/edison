import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "@edison/ai",
    "@edison/contracts",
    "@edison/db",
    "@edison/domain",
  ],
};

export default withWorkflow(nextConfig);
