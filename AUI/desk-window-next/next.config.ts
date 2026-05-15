import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["empty-grapes-ask.loca.lt", "nas.peiying0110.lol"],
  turbopack: {
    root
  }
};

export default nextConfig;
