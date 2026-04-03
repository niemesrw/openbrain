import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test can take up to 30s — Bedrock embedding + metadata extraction
    // adds ~3-5s per capture call.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run test files serially to avoid S3 Vectors eventual-consistency races.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    reporters: ["verbose", "junit"],
    outputFile: { junit: "./test-results/junit.xml" },
  },
});
