/**
 * Bundle the MCP server into a single runnable file: bin/frameless-mcp.mjs.
 *
 * This is what makes `npx -y github:llmer/cabinets` work with no npm publish:
 * npm clones the repo, installs devDependencies, runs `prepare` (this script),
 * and the package's `bin` points at the bundle. Locally it also runs on every
 * `npm install` — it's a single fast esbuild pass.
 *
 * The dev path is unchanged: `npm run mcp` still executes mcp/server.ts via
 * tsx with the tsconfig `@/*` alias; this bundle resolves the same alias at
 * build time and inlines every dependency (ws, the MCP SDK, zod, the engine),
 * so the bin needs nothing but Node at runtime.
 */
import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "bin/frameless-mcp.mjs");

await build({
  entryPoints: [resolve(root, "mcp/server.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  alias: { "@": resolve(root, "src") },
  banner: {
    // Shebang, plus a require() shim: bundled CommonJS dependencies keep
    // require() calls for node builtins, which bare ESM doesn't define.
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "warning",
});
chmodSync(outfile, 0o755);
console.error(`built ${outfile}`);
