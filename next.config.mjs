const isStaticExport = process.env.NEXT_OUTPUT === "export";

const repoName =
  process.env.NEXT_PUBLIC_REPO_NAME ??
  process.env.NEXT_REPO_NAME ??
  process.env.GITHUB_REPOSITORY?.split("/")?.[1];

const forcedBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? process.env.NEXT_BASE_PATH;

const basePath =
  isStaticExport && (forcedBasePath || repoName)
    ? `/${(forcedBasePath || repoName)?.replace(/^\/+/, "").replace(/\/+$/, "")}`
    : undefined;

const assetPrefix = basePath ? `${basePath}/` : undefined;

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: isStaticExport ? "export" : "standalone",
  trailingSlash: isStaticExport,
  images: {
    unoptimized: isStaticExport
  },
  basePath,
  assetPrefix
};

export default nextConfig;
