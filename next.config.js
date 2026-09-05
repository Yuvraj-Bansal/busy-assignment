/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "5mb" }, // CSV imports can be a few hundred KB–a few MB
  },
};
module.exports = nextConfig;
