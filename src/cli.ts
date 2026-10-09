#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from './config.js';
import { ObsConnection } from './obs.js';
import { createServer } from './server.js';
import { errorInfo } from './errors.js';
import { status } from './workflows.js';
import { catalog } from './catalog.js';
import { VERSION, RELEASE_PACKAGE } from './metadata.js';

export const releasePackage = RELEASE_PACKAGE;

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'serve';
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(`OBS Agent MCP ${VERSION}\n\nUsage: obs-agent-mcp [serve|doctor|config|--version]\n\nserve     Start the MCP server on standard input/output (default).\ndoctor    Check OBS connection and report current state as JSON.\nconfig    Print a Claude Desktop / Cursor MCP configuration.\n\nEnvironment:\n  OBS_URL                ws://127.0.0.1:4455 by default\n  OBS_PASSWORD           OBS WebSocket password\n  OBS_TOOL_MODE          curated (default) or full\n  OBS_READ_ONLY          true or false (default)\n  OBS_TIMEOUT_MS         1000..60000, default 10000\n  OBS_EVENT_BUFFER_SIZE  1..2000, default 200\n\nRequires Node.js 22+ and OBS Studio with WebSocket enabled.\nNo credentials or .env files are read from disk automatically.`);
    return;
  }
  if (command === '--version') { console.log(VERSION); return; }
  if (command === 'config') {
    console.log(JSON.stringify({ mcpServers: { obs: { command: 'npx', args: ['-y', releasePackage], env: { OBS_URL: 'ws://127.0.0.1:4455', OBS_PASSWORD: 'REPLACE_WITH_YOUR_OBS_WEBSOCKET_PASSWORD', OBS_TOOL_MODE: 'curated' } } } }, null, 2));
    return;
  }
  if (command !== 'serve' && command !== 'doctor') throw new Error(`Unknown command ${command}. Run obs-agent-mcp --help.`);
  const config = readConfig();
  const obs = new ObsConnection(config);
  if (command === 'doctor') {
    try {
      const result = await status(obs);
      console.log(JSON.stringify({ catalogRequests: catalog.length, ...result }, null, 2));
      if ((result.version as { error?: unknown })?.error) process.exitCode = 1;
    } finally { await obs.close(); }
    return;
  }
  const app = createServer(obs);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.close();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  const transport = new StdioServerTransport();
  app.server.onclose = () => { void shutdown(); };
  await app.server.connect(transport);
  console.error(`OBS Agent MCP ready (${config.mode}; ${config.readOnly ? 'read-only' : 'read/write'}). Connection is established on the first OBS request.`);
}

main().catch(error => { console.error(JSON.stringify(errorInfo(error, process.env.OBS_PASSWORD))); process.exitCode = 1; });
