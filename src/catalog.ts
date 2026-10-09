import AjvModule from 'ajv';
import catalogData from './catalog.json' with { type: 'json' };
import { AgentError } from './errors.js';

export type JsonObject = Record<string, unknown>;
export interface RequestDefinition {
  requestType: string;
  category: string;
  initialVersion: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, object>; required: string[]; additionalProperties: boolean };
}
export const catalog = catalogData as unknown as RequestDefinition[];
export const byRequest = new Map(catalog.map(r => [r.requestType, r]));
const Ajv = AjvModule.default;
export const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map(catalog.map(r => [r.requestType, ajv.compile(r.inputSchema)]));
export const requestToolName = (name: string): string => 'obs_' + name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
export const isReadRequest = (name: string): boolean => name.startsWith('Get');
export const isDestructiveRequest = (name: string): boolean => /^(Remove|Stop|SetCurrentSceneCollection|SetCurrentProfile)/.test(name);

export function validateRequest(name: string, data: JsonObject, readOnly = false): RequestDefinition {
  const def = byRequest.get(name);
  if (!def) throw new AgentError('UNKNOWN_REQUEST', `Unknown OBS request: ${name}. Use obs_list_requests.`);
  if (readOnly && !isReadRequest(name)) throw new AgentError('READ_ONLY', `${name} is disabled by OBS_READ_ONLY.`);
  const validate = validators.get(name)!;
  if (!validate(data)) throw new AgentError('INVALID_ARGUMENTS', `Invalid arguments for ${name}.`, validate.errors);
  return def;
}

// A focused default surface. The complete catalog is available through discovery,
// validated dispatch and batch calls, or individual tools in full mode.
export const curatedRequests = new Set([
  'GetSceneList', 'GetCurrentProgramScene', 'SetCurrentProgramScene', 'CreateScene', 'RemoveScene', 'SetSceneName',
  'GetSceneItemList', 'GetSceneItemId', 'CreateSceneItem', 'RemoveSceneItem', 'DuplicateSceneItem',
  'GetSceneItemTransform', 'SetSceneItemTransform', 'SetSceneItemEnabled', 'SetSceneItemLocked', 'SetSceneItemIndex',
  'GetGroupSceneItemList', 'GetInputList', 'GetInputKindList', 'CreateInput', 'RemoveInput', 'GetInputSettings', 'SetInputSettings',
  'GetInputPropertiesListPropertyItems', 'GetInputMute', 'SetInputMute', 'GetInputVolume', 'SetInputVolume',
  'GetInputAudioSyncOffset', 'SetInputAudioSyncOffset', 'GetInputAudioMonitorType', 'SetInputAudioMonitorType',
  'GetSourceFilterList', 'CreateSourceFilter', 'SetSourceFilterSettings', 'SetSourceFilterEnabled', 'RemoveSourceFilter',
  'GetSceneTransitionList', 'SetCurrentSceneTransition', 'SetCurrentSceneTransitionDuration',
  'SetStudioModeEnabled', 'SetCurrentPreviewScene', 'TriggerStudioModeTransition',
  'GetRecordStatus', 'StartRecord', 'StopRecord', 'PauseRecord', 'ResumeRecord',
  'GetStreamStatus', 'StartStream', 'StopStream', 'GetReplayBufferStatus', 'StartReplayBuffer', 'StopReplayBuffer', 'SaveReplayBuffer', 'GetLastReplayBufferReplay',
  'StartVirtualCam', 'StopVirtualCam', 'GetVirtualCamStatus', 'GetMediaInputStatus', 'SetMediaInputCursor', 'TriggerMediaInputAction',
  'GetVideoSettings', 'GetProfileList', 'GetSceneCollectionList', 'GetRecordDirectory', 'SetRecordDirectory',
]);
