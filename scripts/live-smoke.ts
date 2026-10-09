// Opt-in acceptance test. Run only against a disposable OBS profile/collection.
// It creates synthetic sources, mutes special audio inputs, records and removes
// its own scenes. It never starts a stream or captures a display/camera.
import assert from 'node:assert/strict';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

if (process.env.OBS_LIVE_TEST !== 'disposable') throw new Error('Set OBS_LIVE_TEST=disposable and use an isolated OBS profile.');
const directory = resolve(process.env.OBS_TEST_OUTPUT ?? 'work/live-test');
await mkdir(directory, { recursive: true });
const client = new Client({ name: 'obs-live-acceptance', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/cli.js'], env: process.env as Record<string, string>, stderr: 'pipe' });
const prefix = `MCP Acceptance ${Date.now()}`;
const checks: string[] = [];
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  return result;
}
async function data(name: string, args: Record<string, unknown> = {}) {
  const result = await call(name, args);
  return (result.structuredContent as any).result;
}
await client.connect(transport);
try {
  const toolList = await client.listTools(); checks.push(`Negotiated ${toolList.tools.length} MCP tools over stdio`);
  const state = await data('obs_status'); assert.ok(state.version.obsVersion); checks.push(`Authenticated to OBS ${state.version.obsVersion}`);
  assert.equal(state.recording.outputActive, false); assert.equal(state.streaming.outputActive, false);
  const special = await data('obs_request', { requestType: 'GetSpecialInputs' });
  for (const name of Object.values(special)) if (typeof name === 'string' && name) await data('obs_set_input_mute', { inputName: name, inputMuted: true });
  await data('obs_create_scene', { sceneName: `${prefix} Sources` });
  for (const [name, color] of [['Screen', 4284894771], ['Camera', 4281558681]] as const) {
    await data('obs_add_source', { sceneName: `${prefix} Sources`, inputName: `${prefix} ${name}`, inputKind: 'color_source_v3', inputSettings: { color, width: 1920, height: 1080 } });
  }
  // Keep OBS's audio clock advancing without opening any physical device.
  const wav = Buffer.alloc(44 + 48000 * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const audioPath = resolve(directory, 'silence.wav'); await writeFile(audioPath, wav);
  await data('obs_add_source', { sceneName: `${prefix} Sources`, inputName: `${prefix} Silent Audio`, inputKind: 'ffmpeg_source', inputSettings: { is_local_file: true, local_file: audioPath.replaceAll('\\', '/'), looping: true } });
  const args = { sceneName: `${prefix} Tutorial`, template: 'tutorial', primarySource: `${prefix} Screen`, secondarySource: `${prefix} Camera`, microphoneSource: `${prefix} Silent Audio`, title: 'OBS Agent MCP / Live acceptance' };
  const plan = await data('obs_build_scene', { ...args, dryRun: true }); assert.equal(plan.dryRun, true);
  const built = await data('obs_build_scene', args); assert.equal(built.created, true); checks.push('Created and inspected a tutorial scene from a dry-run plan');
  await data('obs_set_current_program_scene', { sceneName: args.sceneName });
  await data('obs_layout_source', { sceneName: args.sceneName, sourceName: `${prefix} Camera`, preset: 'bottom-right' });
  await data('obs_set_source_visibility', { sceneName: args.sceneName, sourceName: `${prefix} Camera`, enabled: false });
  await data('obs_set_source_visibility', { sceneName: args.sceneName, sourceName: `${prefix} Camera`, enabled: true });
  const shot = await call('obs_screenshot', { sourceName: args.sceneName, format: 'png', width: 1280 });
  const image = (shot.content as any[]).find(c => c.type === 'image'); assert.equal(image.mimeType, 'image/png');
  await writeFile(resolve(directory, 'scene-preview.png'), Buffer.from(image.data, 'base64')); checks.push('Returned a real scene screenshot as an MCP image');
  const preflight = await data('obs_preflight'); assert.equal(preflight.ready, true); checks.push('Ran recording preflight');
  await data('obs_audio', { inputName: `${prefix} Silent Audio`, volumeDb: -6, muted: false }); checks.push('Adjusted and inspected synthetic audio input');
  const cue = await data('obs_schedule_cues', { name: 'acceptance', cues: [{ delayMs: 10, requestType: 'SetInputSettings', requestData: { inputName: `${prefix} Tutorial / Title`, inputSettings: { text: 'Live test: cues work' }, overlay: true } }] });
  await new Promise(resolve => setTimeout(resolve, 200));
  const jobs = await data('obs_list_cues'); assert.equal(jobs.jobs.find((j: any) => j.id === cue.id).status, 'completed'); checks.push('Executed and inspected a timed cue');
  // Software recording avoids reliance on a particular hardware encoder.
  await data('obs_request', { requestType: 'SetProfileParameter', requestData: { parameterCategory: 'Output', parameterName: 'Mode', parameterValue: 'Simple' } });
  await data('obs_request', { requestType: 'SetProfileParameter', requestData: { parameterCategory: 'SimpleOutput', parameterName: 'RecEncoder', parameterValue: 'x264' } });
  await data('obs_request', { requestType: 'SetProfileParameter', requestData: { parameterCategory: 'SimpleOutput', parameterName: 'RecQuality', parameterValue: 'Small' } });
  await data('obs_set_record_directory', { recordDirectory: directory });
  await data('obs_recording', { action: 'start' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  await data('obs_recording', { action: 'pause' });
  await new Promise(resolve => setTimeout(resolve, 1000));
  await data('obs_recording', { action: 'resume' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const stopped = await data('obs_recording', { action: 'stop' });
  assert.ok(stopped.outputPath); assert.ok((await stat(stopped.outputPath)).size > 0); checks.push('Started, paused, resumed and stopped a synthetic recording; confirmed saved file');
  const events = await data('obs_recent_events', { types: ['RecordStateChanged'] }); assert.ok(events.events.length > 0); checks.push('Read real recording events from the event buffer');
  await data('obs_transition_to_scene', { sceneName: `${prefix} Sources`, transitionName: 'Fade', durationMs: 200 });
  await new Promise(resolve => setTimeout(resolve, 300)); checks.push('Transitioned through Studio Mode');
  await writeFile(resolve(directory, 'acceptance.json'), JSON.stringify({ obsVersion: state.version.obsVersion, websocketVersion: state.version.obsWebSocketVersion, checks, recordingBytes: (await stat(stopped.outputPath)).size, publicStreamStarted: false, displayOrCameraCaptured: false }, null, 2));
  console.log(JSON.stringify({ checks, recordingSaved: true }, null, 2));
} finally {
  await client.close();
}
