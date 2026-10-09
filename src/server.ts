import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ObsApi } from './obs.js';
import { AgentError, errorInfo, redact } from './errors.js';
import { createTools, ImageResult } from './tools.js';
import { CueScheduler } from './cues.js';
import { catalog, type JsonObject } from './catalog.js';
import { status } from './workflows.js';
import { VERSION } from './metadata.js';

export function createServer(obs: ObsApi): { server: Server; close: () => Promise<void> } {
  const scheduler = new CueScheduler(obs);
  const tools = createTools(obs, scheduler);
  const server = new Server({ name: 'obs-agent-mcp', version: VERSION }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: 'Control OBS Studio through focused tools or the complete validated request catalog. Start with obs_status and obs_list_requests. Inspect scene item IDs and device property choices before editing. Use obs_screenshot to verify framing. obs_build_scene has dryRun and does not activate by default. Changes affect real OBS; streaming commands broadcast immediately. Timed cues run only while this server process remains alive. Never blindly repeat a failed or timed-out mutation. Read-only mode is enforced on individual dispatched requests. Credentials are redacted from tool output.',
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools.values()].map(t => t.definition) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const tool = tools.get(request.params.name);
      if (!tool) throw new AgentError('UNKNOWN_TOOL', `Unknown tool ${request.params.name}. List available tools first.`);
      const result = await tool.run((request.params.arguments ?? {}) as JsonObject);
      if (result instanceof ImageResult) return { content: [{ type: 'image', data: result.data, mimeType: result.mimeType }, { type: 'text', text: JSON.stringify(result.metadata) }] } satisfies CallToolResult;
      const safe = redact(result, obs.config.password);
      return { content: [{ type: 'text', text: JSON.stringify(safe, null, 2) }], structuredContent: { result: safe }, ...((safe as { ok?: boolean })?.ok === false ? { isError: true } : {}) } satisfies CallToolResult;
    } catch (error) {
      const info = errorInfo(error, obs.config.password);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: info }, null, 2) }], structuredContent: { error: info } } satisfies CallToolResult;
    }
  });
  const resources = [
    { uri: 'obs://status', name: 'OBS status', description: 'Current outputs, scenes, capabilities and performance.', mimeType: 'application/json' },
    { uri: 'obs://scenes', name: 'OBS scenes', description: 'Scene list and current program/preview.', mimeType: 'application/json' },
    { uri: 'obs://requests', name: 'OBS request catalog', description: 'Complete request argument schemas and version requirements.', mimeType: 'application/json' },
    { uri: 'obs://events', name: 'Recent OBS events', description: 'Most recent bounded events observed by this process.', mimeType: 'application/json' },
  ];
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const uri = request.params.uri;
    const data = uri === 'obs://status' ? await status(obs) : uri === 'obs://scenes' ? await obs.request('GetSceneList') : uri === 'obs://requests' ? catalog : uri === 'obs://events' ? obs.events(0, 200) : undefined;
    if (data === undefined) throw new AgentError('UNKNOWN_RESOURCE', `Unknown resource ${uri}.`);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(redact(data, obs.config.password), null, 2) }] };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [
    { name: 'prepare-recording', description: 'Inspect OBS, build a requested recording layout and verify it.', arguments: [{ name: 'brief', description: 'What you plan to record, sources and layout preferences.', required: true }] },
    { name: 'diagnose-obs', description: 'Investigate a recording, layout or stream problem.', arguments: [{ name: 'problem', description: 'Describe the symptoms.', required: true }] },
  ] }));
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    let text: string;
    if (name === 'prepare-recording' && args?.brief) text = `Prepare OBS for this recording: ${args.brief}\nStart with obs_status, obs_preflight and source/device discovery. Use existing sources where appropriate. Inspect properties before creating capture sources. Build a scene with obs_build_scene dryRun first, then create it when the user's request authorizes it. Take obs_screenshot and check framing. Report remaining audio/capture checks honestly. Start recording or streaming only when the user asks for that action.`;
    else if (name === 'diagnose-obs' && args?.problem) text = `Diagnose this OBS problem: ${args.problem}\nUse obs_status, obs_preflight, scene inspection, screenshots and recent events. Separate cumulative counters from current faults. Inspect relevant input settings and filters. Explain the likely cause and apply fixes within the user's requested scope. Do not claim audio signal or stream readiness from configuration alone.`;
    else throw new AgentError('UNKNOWN_PROMPT', 'Unknown prompt or missing required argument.');
    return { messages: [{ role: 'user', content: { type: 'text', text } }] };
  });
  return { server, close: async () => { scheduler.close(); await server.close(); await obs.close(); } };
}
