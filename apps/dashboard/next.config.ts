import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  transpilePackages: ["@gnana/client"],
};

export default withSentryConfig(nextConfig, {
  org: "gnanalytica-7j",
  project: "gnana-sentry",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: true,
});
