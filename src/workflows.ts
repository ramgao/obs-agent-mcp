import type { ObsApi } from './obs.js';
import { AgentError, errorInfo } from './errors.js';
import type { JsonObject } from './catalog.js';

export interface BatchEntry { requestType: string; requestData?: JsonObject }
export async function runBatch(obs: ObsApi, entries: BatchEntry[], stopOnError = true): Promise<unknown> {
  const results: unknown[] = [];
  for (const [index, entry] of entries.entries()) {
    try { results.push({ index, requestType: entry.requestType, ok: true, data: await obs.request(entry.requestType, entry.requestData) }); }
    catch (error) {
      results.push({ index, requestType: entry.requestType, ok: false, error: errorInfo(error, obs.config.password) });
      if (stopOnError) return { ok: false, completed: index, failedIndex: index, skipped: entries.length - index - 1, results, atomic: false };
    }
  }
  return { ok: results.every(r => (r as { ok: boolean }).ok), completed: results.length, results, atomic: false };
}

export async function inspectScene(obs: ObsApi, sceneName?: string): Promise<unknown> {
  const name = sceneName ?? String((await obs.request('GetCurrentProgramScene')).currentProgramSceneName);
  const items = await obs.request('GetSceneItemList', { sceneName: name });
  return { sceneName: name, ...items };
}

export async function recording(obs: ObsApi, action: string): Promise<unknown> {
  const command = ({ status: 'GetRecordStatus', start: 'StartRecord', stop: 'StopRecord', pause: 'PauseRecord', resume: 'ResumeRecord' } as Record<string, string>)[action]!;
  const result = await obs.request(command);
  if (action === 'status') return result;
  const deadline = Date.now() + obs.config.timeoutMs;
  do {
    const state = await obs.request('GetRecordStatus');
    const done = action === 'stop' ? !state.outputActive : action === 'pause' ? state.outputActive && state.outputPaused : state.outputActive && !state.outputPaused;
    if (done) {
      // Give asynchronous frontend/encoder callbacks a turn before a caller
      // issues the next control operation, then confirm the state again.
      await new Promise(resolve => setTimeout(resolve, 100));
      const confirmed = await obs.request('GetRecordStatus');
      const stable = action === 'stop' ? !confirmed.outputActive : action === 'pause' ? confirmed.outputActive && confirmed.outputPaused : confirmed.outputActive && !confirmed.outputPaused;
      if (stable) return { ...result, state: confirmed };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new AgentError('STATE_TIMEOUT', 'OBS accepted the recording command, but its state change has not been confirmed. Inspect recording status before another command.');
}

export async function status(obs: ObsApi): Promise<JsonObject> {
  const requests = { version: 'GetVersion', scenes: 'GetSceneList', recording: 'GetRecordStatus', streaming: 'GetStreamStatus', replayBuffer: 'GetReplayBufferStatus', virtualCamera: 'GetVirtualCamStatus', stats: 'GetStats', video: 'GetVideoSettings' };
  const entries = await Promise.all(Object.entries(requests).map(async ([key, request]) => {
    try { return [key, await obs.request(request)] as const; }
    catch (error) { return [key, { error: errorInfo(error, obs.config.password) }] as const; }
  }));
  return Object.fromEntries(entries);
}

export async function preflight(obs: ObsApi): Promise<unknown> {
  const state = await status(obs);
  const checks: { level: 'pass' | 'warning' | 'error'; check: string; message: string }[] = [];
  if ((state.version as JsonObject)?.error) return { ready: false, checks: [{ level: 'error', check: 'connection', message: 'Cannot query OBS. See connection details.' }], state };
  checks.push({ level: 'pass', check: 'connection', message: 'OBS is connected.' });
  try {
    const scene = await inspectScene(obs) as JsonObject;
    const items = scene.sceneItems as JsonObject[];
    const visible = items.filter(i => i.sceneItemEnabled);
    checks.push({ level: visible.length ? 'pass' : 'warning', check: 'scene', message: visible.length ? `${visible.length} visible items in ${scene.sceneName}.` : 'The current scene has no enabled items.' });
    const inputs = (await obs.request('GetInputList')).inputs as JsonObject[];
    const audio: unknown[] = [];
    for (const input of inputs) {
      try {
        const mute = await obs.request('GetInputMute', { inputName: input.inputName });
        const volume = await obs.request('GetInputVolume', { inputName: input.inputName });
        audio.push({ name: input.inputName, ...mute, ...volume });
      } catch { /* Not every source has audio. */ }
    }
    const unmuted = audio.filter(a => !(a as JsonObject).inputMuted && Number((a as JsonObject).inputVolumeMul) > 0);
    checks.push({ level: unmuted.length ? 'pass' : 'warning', check: 'audio', message: unmuted.length ? `${unmuted.length} audio-capable inputs are unmuted. This does not prove that sound is reaching them.` : 'No unmuted audio input with nonzero volume was found.' });
    state.audio = audio;
  } catch (error) { checks.push({ level: 'error', check: 'sources', message: errorInfo(error).message }); }
  const stats = state.stats as JsonObject;
  if (stats && !stats.error) {
    const missed = Number(stats.renderSkippedFrames ?? 0) + Number(stats.outputSkippedFrames ?? 0);
    checks.push({ level: missed ? 'warning' : 'pass', check: 'frames', message: missed ? `${missed} skipped frames reported cumulatively by OBS. Sample over time to assess current performance.` : 'OBS reports no skipped frames.' });
  }
  return { ready: !checks.some(c => c.level === 'error'), warnings: checks.filter(c => c.level === 'warning').length, checks, state, limits: 'This checks configuration and counters, not actual audio quality, capture content, available disk space or platform stream readiness.' };
}

export async function findItem(obs: ObsApi, sceneName: string, sourceName?: string, sceneItemId?: number): Promise<number> {
  if (sceneItemId !== undefined) return sceneItemId;
  const items = (await obs.request('GetSceneItemList', { sceneName })).sceneItems as JsonObject[];
  const matches = items.filter(i => i.sourceName === sourceName);
  if (matches.length !== 1) throw new AgentError('AMBIGUOUS_ITEM', `Expected one item named ${sourceName} in ${sceneName}, found ${matches.length}. Specify sceneItemId.`);
  return Number(matches[0]!.sceneItemId);
}

export async function layout(obs: ObsApi, args: JsonObject): Promise<unknown> {
  const sceneName = String(args.sceneName);
  const id = await findItem(obs, sceneName, args.sourceName as string | undefined, args.sceneItemId as number | undefined);
  const video = await obs.request('GetVideoSettings');
  const width = Number(video.baseWidth), height = Number(video.baseHeight);
  const boxes: Record<string, number[]> = {
    fullscreen: [0, 0, 1, 1], 'top-left': [0.025, 0.025, 0.25, 0.25], 'top-right': [0.725, 0.025, 0.25, 0.25],
    'bottom-left': [0.025, 0.725, 0.25, 0.25], 'bottom-right': [0.725, 0.725, 0.25, 0.25],
    'left-half': [0, 0, 0.5, 1], 'right-half': [0.5, 0, 0.5, 1],
  };
  const box = args.preset === 'custom' ? [Number(args.x), Number(args.y), Number(args.width), Number(args.height)] : boxes[String(args.preset ?? 'fullscreen')];
  if (!box || box.some(n => !Number.isFinite(n)) || box[2]! <= 0 || box[3]! <= 0 || box[0]! + box[2]! > 1 || box[1]! + box[3]! > 1) {
    throw new AgentError('INVALID_LAYOUT', 'Custom layout requires x, y, width and height as canvas fractions, wholly within the canvas.');
  }
  const before = await obs.request('GetSceneItemTransform', { sceneName, sceneItemId: id });
  const transform = {
    positionX: box[0]! * width, positionY: box[1]! * height, alignment: 5, rotation: 0,
    boundsType: args.fit === 'cover' ? 'OBS_BOUNDS_SCALE_OUTER' : 'OBS_BOUNDS_SCALE_INNER',
    boundsWidth: box[2]! * width, boundsHeight: box[3]! * height, boundsAlignment: 0,
    // Clear previous cropping and mirroring to make presets predictable.
    cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, scaleX: 1, scaleY: 1,
  };
  await obs.request('SetSceneItemTransform', { sceneName, sceneItemId: id, sceneItemTransform: transform });
  return { sceneName, sceneItemId: id, previousTransform: before.sceneItemTransform, appliedTransform: transform };
}

export async function buildScene(obs: ObsApi, args: JsonObject): Promise<unknown> {
  const sceneName = String(args.sceneName);
  const template = String(args.template);
  const existing = (await obs.request('GetSceneList')).scenes as JsonObject[];
  if (existing.some(s => s.sceneName === sceneName)) throw new AgentError('SCENE_EXISTS', `Scene ${sceneName} already exists. Choose a new name.`);
  const inputs = (await obs.request('GetInputList')).inputs as JsonObject[];
  const names = new Set(inputs.map(i => String(i.inputName)));
  for (const key of ['primarySource', 'secondarySource', 'microphoneSource']) {
    if (args[key] && !names.has(String(args[key]))) throw new AgentError('SOURCE_NOT_FOUND', `${args[key]} does not exist. Use obs_add_source first or select an existing source.`);
  }
  if (!args.primarySource) throw new AgentError('SOURCE_REQUIRED', 'primarySource is required. Discover capture devices and create a source first.');
  if (template === 'interview' && !args.secondarySource) throw new AgentError('SOURCE_REQUIRED', 'The interview template needs secondarySource.');
  const sources = [{ sourceName: String(args.primarySource), preset: template === 'interview' ? 'left-half' : 'fullscreen' }];
  if (args.secondarySource) sources.push({ sourceName: String(args.secondarySource), preset: template === 'interview' ? 'right-half' : 'bottom-right' });
  const titleName = `${sceneName} / Title`;
  const backgroundName = `${sceneName} / Background`;
  if (names.has(backgroundName) || (args.title && names.has(titleName))) throw new AgentError('SOURCE_EXISTS', 'Template-generated source names already exist. Choose a different scene name.');
  const plan = { sceneName, template, sources, microphoneSource: args.microphoneSource, title: args.title, activate: args.activate ?? false };
  if (args.dryRun) return { dryRun: true, plan };
  const kinds = (await obs.request('GetInputKindList')).inputKinds as string[];
  const textKind = kinds.includes('text_gdiplus_v2') ? 'text_gdiplus_v2' : kinds.find(k => /^text_ft2_source/.test(k));
  if (args.title && !textKind) throw new AgentError('UNSUPPORTED_SOURCE', 'No supported text source type was found in OBS.');
  const video = await obs.request('GetVideoSettings');
  const createdInputs: string[] = [];
  let createdScene = false;
  try {
    await obs.request('CreateScene', { sceneName });
    createdScene = true;
    await obs.request('CreateInput', { sceneName, inputName: backgroundName, inputKind: 'color_source_v3', inputSettings: { color: args.backgroundColor ?? 4280295456, width: video.baseWidth, height: video.baseHeight }, sceneItemEnabled: true });
    createdInputs.push(backgroundName);
    for (const source of sources) {
      const created = await obs.request('CreateSceneItem', { sceneName, sourceName: source.sourceName, sceneItemEnabled: true });
      await layout(obs, { sceneName, sceneItemId: created.sceneItemId, preset: source.preset });
    }
    if (args.microphoneSource && !sources.some(s => s.sourceName === args.microphoneSource)) {
      await obs.request('CreateSceneItem', { sceneName, sourceName: args.microphoneSource, sceneItemEnabled: true });
    }
    if (args.title) {
      const created = await obs.request('CreateInput', { sceneName, inputName: titleName, inputKind: textKind, inputSettings: { text: args.title, font: { face: 'Arial', size: 48, style: 'Regular', flags: 0 }, color: 16777215 }, sceneItemEnabled: true });
      createdInputs.push(titleName);
      await obs.request('SetSceneItemTransform', { sceneName, sceneItemId: created.sceneItemId, sceneItemTransform: { positionX: Number(video.baseWidth) * 0.04, positionY: Number(video.baseHeight) * 0.04, alignment: 5 } });
    }
    if (args.activate) await obs.request('SetCurrentProgramScene', { sceneName });
    return { created: true, plan, scene: await inspectScene(obs, sceneName) };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    // A timed-out mutation has an uncertain outcome. Do not remove a possibly
    // active scene blindly; return its identifiers for inspection and recovery.
    if (error instanceof AgentError && error.code === 'OBS_TIMEOUT') throw new AgentError('TEMPLATE_OUTCOME_UNKNOWN', 'Template operation timed out. Inspect OBS before cleanup or retry.', { sceneName, createdInputs, cause: errorInfo(error) });
    if (createdScene) try { await obs.request('RemoveScene', { sceneName }); } catch (e) { cleanupErrors.push(errorInfo(e)); }
    for (const inputName of createdInputs.reverse()) try { await obs.request('RemoveInput', { inputName }); } catch (e) { cleanupErrors.push(errorInfo(e)); }
    throw new AgentError('TEMPLATE_FAILED', 'Scene template failed; cleanup was attempted for objects created by this workflow.', { cause: errorInfo(error), cleanupErrors });
  }
}
