import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle every dependency into a single self-contained ESM file. This lets
  // the package run via `npx @txtcel/mcp` with no install step, removes the
  // `file:` workspace dependency at publish time, and avoids the Node 18
  // ERR_REQUIRE_ESM issue from @solana/web3.js -> rpc-websockets -> uuid by
  // inlining everything as ESM (only Node builtins stay external).
  noExternal: [/.*/],
  // Stdio servers must not print anything to stdout besides the MCP protocol,
  // so the shebang is added here and all logging goes to stderr.
  //
  // The ESM bundle inlines CJS deps (safe-buffer/bs58/base-x) that call
  // `require('buffer')` for Node builtins. In an ESM context `require` is
  // undefined, so esbuild's runtime shim throws "Dynamic require of ...".
  // Define a real `require` via createRequire so those builtin lookups work.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __txtcelCreateRequire } from 'node:module';",
      'const require = __txtcelCreateRequire(import.meta.url);',
    ].join('\n'),
  },
})
