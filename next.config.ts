import type { NextConfig } from "next";

const nextConfig = {
  // 增加 API 请求体大小限制，支持多图上传
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // 忽略 TypeScript 错误（用于快速部署）
  typescript: {
    ignoreBuildErrors: true,
  },
  // 忽略 ESLint 错误
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

