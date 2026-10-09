import { writeFile } from 'node:fs/promises';
import { readConfig } from '../src/config.js';
import { ObsConnection } from '../src/obs.js';
import { CueScheduler } from '../src/cues.js';
import { createTools } from '../src/tools.js';
import { catalog, requestToolName } from '../src/catalog.js';

const obs = new ObsConnection(readConfig({ OBS_TOOL_MODE: 'full' }));
const scheduler = new CueScheduler(obs);
const tools = createTools(obs, scheduler);
const defaultObs = new ObsConnection(readConfig({}));
const defaults = createTools(defaultObs, new CueScheduler(defaultObs));
const escape = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = [
  '# Tool reference', '',
  `${defaults.size} tools are exposed in curated mode. Full mode exposes ${tools.size} tools, including all ${catalog.length} catalog requests. Both modes can access the complete catalog through validated dispatch.`, '',
  '## Workflow and discovery tools', '',
  '| Tool | Purpose |', '| --- | --- |',
];
const raw = new Set(catalog.map(r => requestToolName(r.requestType)));
for (const [name, tool] of tools) if (!raw.has(name)) lines.push(`| \`${name}\` | ${escape(tool.definition.description ?? '')} |`);
lines.push('', '## OBS request tools', '', 'Version requirements refer to obs-websocket, not OBS Studio. Newer requests remain discoverable in the bundled catalog, but unsupported operations return an actionable error.', '', '| Tool | OBS request | Category | Since | Default |', '| --- | --- | --- | --- | --- |');
for (const r of catalog) lines.push(`| \`${requestToolName(r.requestType)}\` | \`${r.requestType}\` | ${r.category} | ${r.initialVersion} | ${defaults.has(requestToolName(r.requestType)) ? 'Yes' : 'Full mode'} |`);
lines.push('', 'Argument schemas are available through `obs_list_requests` and the `obs://requests` resource. OBS-specific source settings and enum restrictions can require additional checks by OBS itself.', '');
await writeFile(new URL('../docs/tools.md', import.meta.url), lines.join('\n'));
console.log(`Documented ${defaults.size} default / ${tools.size} full tools.`);
scheduler.close(); await obs.close(); await defaultObs.close();
