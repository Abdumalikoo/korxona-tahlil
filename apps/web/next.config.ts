import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Telefon QR orqali imzo sahifasini ochishi uchun (shu tarmoqdagi manzillar)
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*', '*.local'],
  reactStrictMode: true,
  transpilePackages: ['@korxona/shared'],
};

export default nextConfig;
