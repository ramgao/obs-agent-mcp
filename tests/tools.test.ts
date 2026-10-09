import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readConfig } from '../src/config.js';
import { catalog, validateRequest, requestToolName } from '../src/catalog.js';
import { redact, errorInfo } from '../src/errors.js';
import { CueScheduler } from '../src/cues.js';
import { createTools, ImageResult } from '../src/tools.js';
import { createServer } from '../src/server.js';
import { FakeObs } from './fake-obs.js';

function setup() {
  const obs = new FakeObs();
  const scheduler = new CueScheduler(obs);
  const tools = createTools(obs, scheduler);
  return { obs, scheduler, tools, run: (name: string, args = {}) => tools.get(name)!.run(args) };
}
test('configuration validates mode, URL credentials and integer bounds', () => {
  assert.equal(readConfig({}).url, 'ws://127.0.0.1:4455');
  for (const env of [{ OBS_URL: 'http://example.com' }, { OBS_URL: 'ws://user:secret@localhost' }, { OBS_TOOL_MODE: 'whatever' }, { OBS_TIMEOUT_MS: 'NaN' }, { OBS_TIMEOUT_MS: '999' }, { OBS_READ_ONLY: 'yes' }]) assert.throws(() => readConfig(env));
});
test('catalog validates unknown requests, types, unknown keys and required arguments', () => {
  assert.equal(catalog.length, 147);
  assert.equal(new Set(catalog.map(r => r.requestType)).size, catalog.length);
  assert.throws(() => validateRequest('ExecuteShell', {}));
  assert.throws(() => validateRequest('CreateScene', {}));
  assert.throws(() => validateRequest('CreateScene', { sceneName: 5 }));
  assert.throws(() => validateRequest('CreateScene', { sceneName: 'New', extra: true }));
  assert.throws(() => validateRequest('SetInputVolume', { inputName: 'Mic', inputVolumeDb: 1000 }));
  assert.doesNotThrow(() => validateRequest('GetVersion', {}));
});
test('full mode has unique tools and covers every catalog request', () => {
  const obs = new FakeObs(); obs.config.mode = 'full';
  const scheduler = new CueScheduler(obs);
  const tools = createTools(obs, scheduler);
  for (const request of catalog) assert.ok(tools.has(requestToolName(request.requestType)), `Missing ${request.requestType}`);
  assert.equal([...tools.values()].filter(t => t.definition.name.startsWith('obs_get_')).length > 40, true);
  scheduler.close();
});
test('redaction removes nested secrets and configured password in error text', () => {
  assert.deepEqual(redact({ streamServiceSettings: { key: 'secret' }, message: 'bad PWD', password: 'x', nested: [{ token: 'x' }] }, 'PWD'), { streamServiceSettings: { key: '[REDACTED]' }, message: 'bad [REDACTED]', password: '[REDACTED]', nested: [{ token: '[REDACTED]' }] });
});
test('empty OBS error comments become actionable state messages', () => {
  assert.match(errorInfo({ code: 503, message: '' }).message, /paused state/);
});
test('recording helper waits for asynchronous OBS state changes', async () => {
  class RecordingObs extends FakeObs {
    state = { outputActive: false, outputPaused: false };
    override async request(name: string, data = {}) {
      if (name === 'GetRecordStatus') return { ...this.state };
      if (['StartRecord', 'PauseRecord', 'ResumeRecord', 'StopRecord'].includes(name)) {
        setTimeout(() => { this.state = { outputActive: name !== 'StopRecord', outputPaused: name === 'PauseRecord' }; }, 25);
        return name === 'StopRecord' ? { outputPath: '/recordings/demo.mkv' } : {};
      }
      return super.request(name, data);
    }
  }
  const obs = new RecordingObs();
  const scheduler = new CueScheduler(obs);
  const tools = createTools(obs, scheduler);
  for (const action of ['start', 'pause', 'resume', 'stop']) {
    const result = await tools.get('obs_recording')!.run({ action }) as any;
    assert.equal(result.state.outputActive, action !== 'stop');
    assert.equal(result.state.outputPaused, action === 'pause');
    if (action === 'stop') assert.equal(result.outputPath, '/recordings/demo.mkv');
  }
  scheduler.close();
});
test('read-only enforcement cannot be bypassed by dispatch, batch, helpers or cues', async () => {
  const { obs, run, scheduler } = setup(); obs.config.readOnly = true;
  await run('obs_request', { requestType: 'GetVersion' });
  await assert.rejects(run('obs_request', { requestType: 'CreateScene', requestData: { sceneName: 'X' } }), /disabled/);
  await assert.rejects(run('obs_batch', { requests: [{ requestType: 'CreateScene', requestData: { sceneName: 'X' } }] }), /disabled/);
  await assert.rejects(run('obs_recording', { action: 'start' }), /disabled/);
  await assert.rejects(run('obs_audio', { inputName: 'Camera', muted: true }), /disabled/);
  await assert.rejects(run('obs_schedule_cues', { name: 'x', cues: [{ delayMs: 1, requestType: 'StartRecord' }] }), /disabled/);
  assert.equal(obs.calls.some(c => !c.name.startsWith('Get')), false);
  scheduler.close();
});
test('batch validates every entry before the first mutation and reports partial failure', async () => {
  const { obs, run } = setup();
  await assert.rejects(run('obs_batch', { requests: [{ requestType: 'CreateScene', requestData: { sceneName: 'New' } }, { requestType: 'CreateScene', requestData: {} }] }));
  assert.equal(obs.calls.length, 0);
  obs.failOn = 'StartRecord';
  const result = await run('obs_batch', { requests: [{ requestType: 'GetVersion' }, { requestType: 'StartRecord' }, { requestType: 'GetStats' }] }) as any;
  assert.equal(result.ok, false); assert.equal(result.failedIndex, 1); assert.equal(result.skipped, 1);
  assert.equal(obs.calls.length, 2);
});
test('layout converts fractions to pixels and retains the original transform', async () => {
  const { obs, run } = setup();
  const result = await run('obs_layout_source', { sceneName: 'Main', sourceName: 'Camera', preset: 'bottom-right' }) as any;
  assert.equal(result.sceneItemId, 2);
  assert.deepEqual(result.previousTransform, { positionX: 12, positionY: 24 });
  const transform = obs.calls.find(c => c.name === 'SetSceneItemTransform')!.data.sceneItemTransform as any;
  assert.equal(transform.positionX, 1392); assert.equal(transform.boundsWidth, 480);
  await assert.rejects(run('obs_layout_source', { sceneName: 'Main', sceneItemId: 1, preset: 'custom', x: 0.9, y: 0, width: 0.5, height: 1 }));
});
test('dry-run scene templates and missing source failures make no changes', async () => {
  const { obs, run } = setup();
  const result = await run('obs_build_scene', { sceneName: 'Tutorial', template: 'tutorial', primarySource: 'Screen', secondarySource: 'Camera', dryRun: true }) as any;
  assert.equal(result.dryRun, true);
  await assert.rejects(run('obs_build_scene', { sceneName: 'Bad', template: 'tutorial', primarySource: 'Missing' }));
  assert.equal(obs.calls.some(c => !c.name.startsWith('Get')), false);
});
test('scene workflow cleans up only newly created objects after a failure', async () => {
  const { obs, run } = setup(); obs.failOn = 'SetSceneItemTransform';
  await assert.rejects(run('obs_build_scene', { sceneName: 'Tutorial', template: 'tutorial', primarySource: 'Screen' }), /cleanup/);
  assert.deepEqual(obs.sceneNames, ['Main']);
  assert.equal(obs.inputs.some(i => i.inputName === 'Screen'), true);
  assert.equal(obs.inputs.some(i => i.inputName === 'Tutorial / Background'), false);
});
test('screenshot returns native image content and preflight labels its limits', async () => {
  const { run } = setup();
  assert.ok(await run('obs_screenshot') instanceof ImageResult);
  const result = await run('obs_preflight') as any;
  assert.equal(result.ready, true);
  assert.match(result.limits, /not actual audio quality/);
});
test('OBS image/jpg screenshots normalize to MCP image/jpeg', async () => {
  class JpegObs extends FakeObs {
    override async request(name: string, data = {}) {
      if (name === 'GetSourceScreenshot') return { imageData: 'data:image/jpg;base64,aGVsbG8=' };
      return super.request(name, data);
    }
  }
  const obs = new JpegObs(); const scheduler = new CueScheduler(obs);
  const result = await createTools(obs, scheduler).get('obs_screenshot')!.run({ format: 'jpg' }) as ImageResult;
  assert.equal(result.mimeType, 'image/jpeg'); assert.equal(result.data, 'aGVsbG8=');
  scheduler.close();
});
test('cue jobs execute in delay order, cancel pending commands, and stop after errors', async () => {
  const { obs, run, scheduler } = setup();
  const job = await run('obs_schedule_cues', { name: 'test', cues: [{ delayMs: 20, requestType: 'SetCurrentProgramScene', requestData: { sceneName: 'B' } }, { delayMs: 0, requestType: 'SetCurrentProgramScene', requestData: { sceneName: 'A' } }] }) as any;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(obs.calls.filter(c => c.name === 'SetCurrentProgramScene').map(c => c.data.sceneName), ['A', 'B']);
  const cancelled = await run('obs_schedule_cues', { name: 'cancel', cues: [{ delayMs: 1000, requestType: 'StartRecord' }] }) as any;
  await run('obs_cancel_cues', { id: cancelled.id });
  assert.equal((scheduler.list().find((j: any) => j.id === cancelled.id) as any).status, 'cancelled');
  assert.equal((scheduler.list().find((j: any) => j.id === job.id) as any).status, 'completed');
  obs.failOn = 'StartRecord';
  const failed = scheduler.schedule('fail', [{ delayMs: 0, requestType: 'StartRecord' }, { delayMs: 5, requestType: 'StopRecord' }]) as any;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((scheduler.list().find((j: any) => j.id === failed.id) as any).status, 'failed');
  assert.equal(obs.calls.some(c => c.name === 'StopRecord'), false);
  scheduler.close();
});
test('real MCP client negotiates tools/resources/prompts, errors, redaction and images', async () => {
  const obs = new FakeObs();
  const app = createServer(obs);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await app.server.connect(st); await client.connect(ct);
  try {
    const tools = await client.listTools(); assert.ok(tools.tools.length > 80);
    assert.equal((await client.listResources()).resources.length, 4);
    assert.equal((await client.listPrompts()).prompts.length, 2);
    assert.equal((await client.getPrompt({ name: 'prepare-recording', arguments: { brief: 'coding' } })).messages.length, 1);
    const status = await client.callTool({ name: 'obs_status' }); assert.equal(status.isError, undefined);
    const bad = await client.callTool({ name: 'obs_create_scene', arguments: {} }); assert.equal(bad.isError, true);
    const image = await client.callTool({ name: 'obs_screenshot' }); assert.equal((image.content as any[])[0].type, 'image');
    const resource = await client.readResource({ uri: 'obs://requests' }); assert.ok(resource.contents.length);
  } finally { await client.close(); await app.close(); }
});
