import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ajv, catalog, curatedRequests, isDestructiveRequest, isReadRequest, requestToolName, validateRequest, type JsonObject } from './catalog.js';
import type { ObsApi } from './obs.js';
import { AgentError } from './errors.js';
import { buildScene, findItem, inspectScene, layout, preflight, runBatch, status, recording, type BatchEntry } from './workflows.js';
import { CueScheduler, type Cue } from './cues.js';

export class ImageResult {
  constructor(public data: string, public mimeType: string, public metadata: unknown) {}
}
export interface AgentTool { definition: Tool; run(args: JsonObject): Promise<unknown> }
const str = (description: string) => ({ type: 'string', minLength: 1, description });
const bool = (description: string) => ({ type: 'boolean', description });
const num = (description: string, minimum?: number, maximum?: number) => ({ type: 'number', description, ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) });
const int = (description: string, minimum?: number, maximum?: number) => ({ ...num(description, minimum, maximum), type: 'integer' });
const en = (values: string[], description: string) => ({ type: 'string', enum: values, description });
const obj = (description: string) => ({ type: 'object', additionalProperties: true, description });
const batchItem = { type: 'object', additionalProperties: false, properties: { requestType: str('Exact OBS request name; discover with obs_list_requests.'), requestData: obj('Request arguments matching the discovered schema.') }, required: ['requestType'] };

export function createTools(obs: ObsApi, scheduler: CueScheduler): Map<string, AgentTool> {
  const tools = new Map<string, AgentTool>();
  function add(name: string, description: string, properties: Record<string, object>, required: string[], run: (args: JsonObject) => Promise<unknown>, readOnly = false, destructive = false): void {
    const inputSchema = { type: 'object' as const, properties, required, additionalProperties: false };
    const validate = ajv.compile(inputSchema);
    tools.set(name, {
      definition: { name, description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: false } },
      run: async args => {
        if (!validate(args)) throw new AgentError('INVALID_ARGUMENTS', `Invalid arguments for ${name}.`, validate.errors);
        if (obs.config.readOnly && !readOnly) throw new AgentError('READ_ONLY', `${name} is disabled by OBS_READ_ONLY.`);
        return run(args);
      },
    });
  }

  add('obs_status', 'Inspect connection/version, scenes, recording, stream, replay buffer, virtual camera, video settings and performance. Individual unavailable sections include errors.', {}, [], () => status(obs), true);
  add('obs_preflight', 'Check scene visibility, unmuted audio-capable inputs and skipped-frame counters before a recording. Reports warnings; it cannot prove microphone signal or streaming readiness.', {}, [], () => preflight(obs), true);
  add('obs_inspect_scene', 'Inspect a named scene or the current program scene, including item IDs, transforms, visibility and source types. Repeated source names require item IDs for edits.', { sceneName: str('Scene name; omit to inspect the current program scene.') }, [], a => inspectScene(obs, a.sceneName as string | undefined), true);
  add('obs_list_requests', 'Discover the full OBS API, request schemas and minimum WebSocket versions. With supportedOnly=true, filter against the connected OBS capabilities. Use this before obs_request.', {
    query: str('Case-insensitive match against request name or category.'), category: str('Exact category, such as inputs, scene items, record, stream or filters.'), supportedOnly: bool('Query OBS to return only supported requests.'), includeSchemas: bool('Include argument schemas; default true.'),
  }, [], async a => {
    let supported: Set<string> | undefined;
    if (a.supportedOnly) supported = new Set((await obs.request('GetVersion')).availableRequests as string[]);
    const query = String(a.query ?? '').toLowerCase();
    return { readOnly: obs.config.readOnly, requests: catalog.filter(r => (!query || `${r.requestType} ${r.category}`.toLowerCase().includes(query)) && (!a.category || r.category === a.category) && (!supported || supported.has(r.requestType))).map(r => ({ ...r, enabled: !obs.config.readOnly || isReadRequest(r.requestType), ...(a.includeSchemas === false ? { inputSchema: undefined } : {}) })) };
  }, true);
  add('obs_request', 'Run one validated OBS API request from obs_list_requests. Unknown operations and invalid arguments are rejected. Never repeat a timed-out mutation without inspecting its outcome. Supports the full catalog in either tool mode.', { requestType: str('Exact request name, e.g. SetInputAudioBalance.'), requestData: obj('Arguments matching the request schema.') }, ['requestType'], a => obs.request(String(a.requestType), (a.requestData ?? {}) as JsonObject), true);
  // obs_request is a dispatcher: its annotation must not claim all calls are reads.
  tools.get('obs_request')!.definition.annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  add('obs_batch', 'Execute up to 100 validated requests sequentially. Every request is validated before any is run. Reports partial results and stops on the first failure by default. This is not an atomic transaction.', { requests: { type: 'array', items: batchItem, minItems: 1, maxItems: 100 }, stopOnError: bool('Stop after the first failure; default true.') }, ['requests'], async a => {
    const entries = a.requests as BatchEntry[];
    entries.forEach(e => validateRequest(e.requestType, e.requestData ?? {}, obs.config.readOnly));
    return runBatch(obs, entries, a.stopOnError !== false);
  }, true);
  tools.get('obs_batch')!.definition.annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  add('obs_screenshot', 'Return an actual MCP image of a source or scene, defaulting to the current program scene. Use to visually check framing and layout. No screenshot file is written.', { sourceName: str('Scene or source name.'), width: int('Image width in pixels; default 1280.', 64, 1920), format: en(['png', 'jpg'], 'Image format; default jpg.') }, [], async a => {
    const sourceName = a.sourceName ?? (await obs.request('GetCurrentProgramScene')).currentProgramSceneName;
    const format = String(a.format ?? 'jpg');
    const result = await obs.request('GetSourceScreenshot', { sourceName, imageFormat: format, imageWidth: a.width ?? 1280 });
    const match = String(result.imageData).match(/^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new AgentError('INVALID_IMAGE', 'OBS returned an unrecognized screenshot payload.');
    return new ImageResult(match[2]!, match[1] === 'image/jpg' ? 'image/jpeg' : match[1]!, { sourceName, width: a.width ?? 1280 });
  }, true);
  add('obs_layout_source', 'Fit a scene item into a fullscreen, corner, half-screen or custom layout. Returns the previous transform for restoration. Resets cropping, rotation and mirroring. Prefer fit=contain; cover can extend beyond the requested box.', {
    sceneName: str('Scene containing the item.'), sourceName: str('Source name, if unique in the scene.'), sceneItemId: int('Specific item ID; preferred when a source appears more than once.', 0),
    preset: en(['fullscreen', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'left-half', 'right-half', 'custom'], 'Layout preset; default fullscreen.'),
    fit: en(['contain', 'cover'], 'Keep the whole source visible, or scale it to cover the box.'),
    x: num('Custom left position as a canvas fraction.', 0, 1), y: num('Custom top position as a canvas fraction.', 0, 1), width: num('Custom width as a canvas fraction.', 0.001, 1), height: num('Custom height as a canvas fraction.', 0.001, 1),
  }, ['sceneName'], a => layout(obs, a));
  add('obs_add_source', 'Create an OBS input in a scene. Discover inputKind with obs_get_input_kind_list and device/settings choices with GetInputDefaultSettings and GetInputPropertiesListPropertyItems. OBS device settings differ by platform.', {
    sceneName: str('Destination scene.'), inputName: str('New unique source name.'), inputKind: str('Discovered OBS input kind.'), inputSettings: obj('Settings appropriate to the input kind; omitted means OBS defaults.'), enabled: bool('Show the source in the scene; default true.'),
  }, ['sceneName', 'inputName', 'inputKind'], a => obs.request('CreateInput', { sceneName: a.sceneName, inputName: a.inputName, inputKind: a.inputKind, inputSettings: a.inputSettings ?? {}, sceneItemEnabled: a.enabled !== false }));
  add('obs_build_scene', 'Build a new tutorial, gaming, presentation or interview scene using existing sources. Adds a background and optional title. Supports a dry-run plan; on failure attempts cleanup only for newly created objects. Does not change the live scene unless activate=true.', {
    sceneName: str('New scene name; existing scenes are never overwritten.'), template: en(['tutorial', 'gaming', 'presentation', 'interview'], 'Layout type. Interview uses two half-screen sources; other templates use fullscreen plus an optional corner source.'),
    primarySource: str('Existing main screen, window, camera or media source.'), secondarySource: str('Existing webcam or second guest source; required for interview.'), microphoneSource: str('Existing microphone source to include.'), title: str('Optional title text.'),
    backgroundColor: int('OBS packed ABGR color including alpha.', 0, 4294967295), activate: bool('Switch the live program to the new scene; default false.'), dryRun: bool('Return a plan without modifying OBS.'),
  }, ['sceneName', 'template', 'primarySource'], a => buildScene(obs, a));
  add('obs_recording', 'Start, stop, pause, resume or inspect recording. Waits for OBS to confirm the state change before returning. Stop returns the saved recording path. Check status before issuing commands when the current state is uncertain.', { action: en(['status', 'start', 'stop', 'pause', 'resume'], 'Recording operation.') }, ['action'], a => recording(obs, String(a.action)), true);
  tools.get('obs_recording')!.definition.annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  add('obs_streaming', 'Inspect, start or stop streaming with the settings already configured in OBS. Starting sends the current scene to the configured platform immediately. This tool does not configure accounts or disclose stream keys.', { action: en(['status', 'start', 'stop'], 'Streaming operation.') }, ['action'], a => obs.request(({ status: 'GetStreamStatus', start: 'StartStream', stop: 'StopStream' } as Record<string, string>)[String(a.action)]!), true);
  tools.get('obs_streaming')!.definition.annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  add('obs_replay', 'Inspect, start, stop or save the OBS replay buffer, or get the most recent replay path. Duration and encoding must already be configured in OBS.', { action: en(['status', 'start', 'stop', 'save', 'last-path'], 'Replay buffer operation.') }, ['action'], a => obs.request(({ status: 'GetReplayBufferStatus', start: 'StartReplayBuffer', stop: 'StopReplayBuffer', save: 'SaveReplayBuffer', 'last-path': 'GetLastReplayBufferReplay' } as Record<string, string>)[String(a.action)]!), true);
  tools.get('obs_replay')!.definition.annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  add('obs_audio', 'Inspect an audio input, or set mute, volume in decibels, sync offset and monitoring. Changes run sequentially and can partially succeed; inspect after a failure. Monitoring modes depend on OBS audio configuration.', {
    inputName: str('Audio input/source name.'), muted: bool('Set mute explicitly.'), volumeDb: num('Volume in decibels.', -100, 26), syncOffsetMs: int('Audio synchronization offset in milliseconds.', -950, 20000), monitorType: en(['OBS_MONITORING_TYPE_NONE', 'OBS_MONITORING_TYPE_MONITOR_ONLY', 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'], 'OBS monitoring mode.'),
  }, ['inputName'], async a => {
    const { inputName } = a;
    if (a.muted !== undefined) await obs.request('SetInputMute', { inputName, inputMuted: a.muted });
    if (a.volumeDb !== undefined) await obs.request('SetInputVolume', { inputName, inputVolumeDb: a.volumeDb });
    if (a.syncOffsetMs !== undefined) await obs.request('SetInputAudioSyncOffset', { inputName, inputAudioSyncOffset: a.syncOffsetMs });
    if (a.monitorType !== undefined) await obs.request('SetInputAudioMonitorType', { inputName, monitorType: a.monitorType });
    return { inputName, ...await obs.request('GetInputMute', { inputName }), ...await obs.request('GetInputVolume', { inputName }), ...await obs.request('GetInputAudioSyncOffset', { inputName }), ...await obs.request('GetInputAudioMonitorType', { inputName }) };
  }, true);
  tools.get('obs_audio')!.definition.annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  add('obs_transition_to_scene', 'Transition the live program to a scene using Studio Mode. Validates the target first, enables Studio Mode, optionally selects a transition/duration, sets preview and triggers the transition. These are global OBS settings and are retained.', {
    sceneName: str('Target scene.'), transitionName: str('Existing transition name, e.g. Fade.'), durationMs: int('Transition duration in milliseconds.', 50, 20000),
  }, ['sceneName'], async a => {
    await obs.request('GetSceneItemList', { sceneName: a.sceneName });
    if (a.transitionName) {
      const list = (await obs.request('GetSceneTransitionList')).transitions as JsonObject[];
      if (!list.some(t => t.transitionName === a.transitionName)) throw new AgentError('TRANSITION_NOT_FOUND', 'Requested transition does not exist.');
    }
    await obs.request('SetStudioModeEnabled', { studioModeEnabled: true });
    if (a.transitionName) await obs.request('SetCurrentSceneTransition', { transitionName: a.transitionName });
    if (a.durationMs !== undefined) await obs.request('SetCurrentSceneTransitionDuration', { transitionDuration: a.durationMs });
    await obs.request('SetCurrentPreviewScene', { sceneName: a.sceneName });
    await obs.request('TriggerStudioModeTransition');
    return { transitionTriggered: true, sceneName: a.sceneName };
  });
  add('obs_set_source_visibility', 'Show or hide one source item by source name or item ID. Does not change the source in other scenes.', {
    sceneName: str('Scene containing the item.'), sourceName: str('Source name if unique.'), sceneItemId: int('Item ID if repeated.', 0), enabled: bool('Whether the item should be visible.'),
  }, ['sceneName', 'enabled'], async a => {
    const id = await findItem(obs, String(a.sceneName), a.sourceName as string | undefined, a.sceneItemId as number | undefined);
    await obs.request('SetSceneItemEnabled', { sceneName: a.sceneName, sceneItemId: id, sceneItemEnabled: a.enabled });
    return { sceneName: a.sceneName, sceneItemId: id, enabled: a.enabled };
  });
  add('obs_recent_events', 'Read bounded OBS event history since this MCP process connected. IDs are monotonic within this process. Old events are evicted; use nextAfterId to continue polling. This is not persistent monitoring.', {
    afterId: int('Only return events after this ID; default 0.', 0), limit: int('Maximum returned entries; default 50.', 1, 200), types: { type: 'array', items: str('OBS event name, e.g. RecordStateChanged.'), maxItems: 100 },
  }, [], async a => {
    await obs.request('GetVersion');
    const events = obs.events(a.afterId as number | undefined, a.limit as number | undefined, a.types as string[] | undefined);
    return { events, nextAfterId: events.at(-1)?.id ?? a.afterId ?? 0, bufferCapacity: obs.config.eventBufferSize };
  }, true);
  add('obs_wait_for_event', 'Wait up to 30 seconds for an OBS event matching a type and cursor. Returns immediately if a matching buffered event exists. On timeout returns matched=false.', {
    type: str('OBS event name, e.g. RecordStateChanged.'), afterId: int('Only match events after this ID; default 0.', 0), timeoutMs: int('Wait duration, default 5000 ms.', 0, 30000),
  }, ['type'], async a => {
    await obs.request('GetVersion');
    const deadline = Date.now() + Number(a.timeoutMs ?? 5000);
    do {
      const events = obs.events(Number(a.afterId ?? 0), 1, [String(a.type)]);
      if (events.length) return { matched: true, event: events[0] };
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())));
    } while (Date.now() <= deadline);
    return { matched: false, type: a.type };
  }, true);
  add('obs_schedule_cues', 'Schedule up to 100 OBS commands at delays measured from submission, up to one hour. Runs in the background while this MCP process stays alive; stops on the first failure. Jobs do not survive restart. Validate live-output commands carefully.', {
    name: str('Human-readable cue job name.'), cues: { type: 'array', minItems: 1, maxItems: 100, items: { ...batchItem, properties: { ...batchItem.properties, delayMs: int('Delay from submission in milliseconds.', 0, 3600000) }, required: ['delayMs', 'requestType'] } },
  }, ['name', 'cues'], async a => {
    const supported = new Set((await obs.request('GetVersion')).availableRequests as string[]);
    for (const cue of a.cues as Cue[]) if (!supported.has(cue.requestType)) throw new AgentError('UNSUPPORTED_REQUEST', `${cue.requestType} is not supported by this OBS version.`);
    return scheduler.schedule(String(a.name), a.cues as Cue[]);
  });
  add('obs_list_cues', 'Read scheduled cue jobs, progress and results for this process.', {}, [], async () => ({ jobs: scheduler.list() }), true);
  add('obs_cancel_cues', 'Cancel pending cues for a job. A command already sent to OBS cannot be recalled.', { id: str('Job ID returned by obs_schedule_cues.') }, ['id'], async a => scheduler.cancel(String(a.id)));

  for (const def of catalog) {
    if (obs.config.mode !== 'full' && !curatedRequests.has(def.requestType)) continue;
    const name = requestToolName(def.requestType);
    if (tools.has(name)) throw new Error(`Duplicate tool name: ${name}`);
    const validate = ajv.compile(def.inputSchema);
    tools.set(name, {
      definition: { name, description: `${def.description} Minimum obs-websocket ${def.initialVersion}.`, inputSchema: def.inputSchema, annotations: { readOnlyHint: isReadRequest(def.requestType), destructiveHint: isDestructiveRequest(def.requestType), idempotentHint: isReadRequest(def.requestType), openWorldHint: false } },
      run: async args => {
        if (!validate(args)) throw new AgentError('INVALID_ARGUMENTS', `Invalid arguments for ${name}.`, validate.errors);
        validateRequest(def.requestType, args, obs.config.readOnly);
        return obs.request(def.requestType, args);
      },
    });
  }
  return tools;
}
