import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  allowedDevOrigins: ['3.112.83.83'],
  async rewrites() {
    return [
      {
        source: '/api/python/:path*',
        destination: 'http://python-env:8000/:path*',
      },
    ];
  },
};

export default nextConfig;
