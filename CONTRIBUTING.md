# Contributing

Use Node.js 22 or newer. Run `npm ci`, make your change, then run `npm run verify` and `npm run docs:tools`.

The server uses the official MCP TypeScript SDK and OBS WebSocket 5. Tool definitions are JSON Schema validated before execution. Keep stdout exclusively for MCP protocol messages in serve mode. CLI help, configuration and diagnostics are separate commands.

Changes to workflows need tests for successful behavior, partial failure and read-only enforcement. Tests must not record a real display, activate a user's microphone, or start a public stream. Live checks belong in an isolated OBS instance with synthetic sources.

`src/catalog.json` and `src/event-types.json` contain protocol facts. To update them, download the official protocol JSON at a fixed commit into a temporary location, run `node scripts/generate-catalog.mjs /path/to/protocol.json`, update the provenance in `docs/architecture.md`, and inspect the diff. Do not copy upstream documentation prose into the catalog.

Commit the lockfile. Run `npm audit --omit=dev`. Releases are installable npm tarballs attached to GitHub releases; this project does not assume access to an npm registry publishing account.
