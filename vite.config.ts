/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { cabinetsLive } from "./src/dev/cabinetsLivePlugin";

// Local-first single-page app. No backend, no persistent DB — state lives in
// the browser (localStorage) and projects round-trip through JSON files. The
// dev-only `cabinetsLive` plugin streams an agent's MCP edits into the running
// app (it is apply:"serve", so the production build is untouched).
export default defineConfig({
  plugins: [react(), cabinetsLive()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "mcp/**/*.test.ts"],
  },
});
