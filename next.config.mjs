/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",  // Add standalone output for better optimization
  // Suppress absolute-path bake-in for portable build artifacts.
  outputFileTracingRoot: process.cwd(),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'mcr.microsoft.com',
      },
      {
        protocol: 'https',
        hostname: '*.azurecr.io',
      },
      {
        protocol: 'https',
        hostname: '*.amazonaws.com',
      },
    ],
  },
  // CORS is intentionally NOT configured here. Next.js API routes are
  // same-origin by default, which is the correct posture for this SPA.
  // If you need cross-origin access from a known consumer, set
  // ALLOWED_ORIGINS (comma-separated) and add an explicit headers() block
  // that allowlists only those origins — never combine "*" with
  // Access-Control-Allow-Credentials: true.
  // Enable Turbopack (default in Next.js 16)
  turbopack: {},
  // Redirect old SBOM search URL to unified search page
  async redirects() {
    return [
      {
        source: '/registry/sbom-search',
        destination: '/registry/search',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
