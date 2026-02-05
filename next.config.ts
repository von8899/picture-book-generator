import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 增加 API 请求体大小限制，支持多图上传
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;

