import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: {
    "/api/**": ["./assets/fonts/**"],
    "/admin/**": ["./assets/fonts/**"],
  },
  experimental: {
    // Two root layouts ([locale] and admin) means no single layout can render a 404.
    globalNotFound: true,
  },
  async redirects() {
    return [
      { source: "/", destination: "/ar/join", permanent: false },
      { source: "/join", destination: "/ar/join", permanent: false },
      { source: "/privacy", destination: "/ar/privacy", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
