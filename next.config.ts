import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // File attachments are uploaded through server actions (max 4 MB per file, see
      // src/modules/attachments). Vercel functions accept at most 4.5 MB per request.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
