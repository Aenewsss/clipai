/** @type {import('next').NextConfig} */

// Validate required env vars at startup (skipped during build on CI)
const { validateEnv } = require('./lib/env-validation');
validateEnv();

const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig
