import { defineConfig } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

const PORT = 3000;
const AUTH_FILE = "playwright/.auth/user.json";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  // Hosted Supabase round-trips from a dev machine can be slow.
  expect: { timeout: 15_000 },
  // Every spec drives the same seeded workspace, so the suite runs serially
  // rather than racing itself.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      use: { storageState: AUTH_FILE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
