import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resolve inexpensive local route metadata into the initial document head.
  // This keeps canonical/robots tags readable without deferred metadata processing.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
