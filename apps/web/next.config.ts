import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  transpilePackages: ["@crm/core", "@crm/db", "@crm/shared"],
  serverExternalPackages: ["pg", "sharp"],
  poweredByHeader: false,
  typedRoutes: false,
  async headers() {
    return [
      // Todo menos el chat público, que se inserta en el sitio web de la inmobiliaria.
      { source: "/((?!chat/).*)", headers: securityHeaders },
      {
        source: "/chat/:path*",
        headers: [
          ...securityHeaders.filter((h) => h.key !== "X-Frame-Options"),
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default config;
