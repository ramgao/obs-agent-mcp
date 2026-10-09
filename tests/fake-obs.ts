import { readConfig } from '../src/config.js';
import { catalog, validateRequest, type JsonObject } from '../src/catalog.js';
import type { ObsApi, EventEntry } from '../src/obs.js';

export class FakeObs implements ObsApi {
  config = readConfig({});
  calls: { name: string; data: JsonObject }[] = [];
  sceneNames = ['Main'];
  inputs: JsonObject[] = [{ inputName: 'Screen', inputKind: 'color_source_v3' }, { inputName: 'Camera', inputKind: 'color_source_v3' }];
  eventEntries: EventEntry[] = [];
  failOn?: string;
  async request(name: string, data: JsonObject = {}): Promise<JsonObject> {
    validateRequest(name, data, this.config.readOnly);
    this.calls.push({ name, data });
    if (name === this.failOn) throw new Error(`Simulated failure: ${name}`);
    switch (name) {
      case 'GetVersion': return { availableRequests: catalog.map(r => r.requestType), obsVersion: '32.1.2' };
      case 'GetVideoSettings': return { baseWidth: 1920, baseHeight: 1080 };
      case 'GetSceneList': return { scenes: this.sceneNames.map(sceneName => ({ sceneName })), currentProgramSceneName: 'Main' };
      case 'GetCurrentProgramScene': return { currentProgramSceneName: 'Main' };
      case 'GetSceneItemList': return { sceneItems: [{ sourceName: 'Screen', sceneItemId: 1, sceneItemEnabled: true }, { sourceName: 'Camera', sceneItemId: 2, sceneItemEnabled: true }] };
      case 'GetSceneItemTransform': return { sceneItemTransform: { positionX: 12, positionY: 24 } };
      case 'GetInputList': return { inputs: this.inputs };
      case 'GetInputKindList': return { inputKinds: ['color_source_v3', 'text_gdiplus_v2'] };
      case 'CreateScene': this.sceneNames.push(String(data.sceneName)); return {};
      case 'RemoveScene': this.sceneNames = this.sceneNames.filter(n => n !== data.sceneName); return {};
      case 'CreateInput': this.inputs.push({ inputName: data.inputName }); return { sceneItemId: 3 };
      case 'RemoveInput': this.inputs = this.inputs.filter(i => i.inputName !== data.inputName); return {};
      case 'CreateSceneItem': return { sceneItemId: 4 };
      case 'GetInputMute': return { inputMuted: false };
      case 'GetInputVolume': return { inputVolumeDb: -3, inputVolumeMul: 0.7 };
      case 'GetSourceScreenshot': return { imageData: 'data:image/png;base64,aGVsbG8=' };
      case 'GetStats': return { renderSkippedFrames: 0, outputSkippedFrames: 0 };
      default: return {};
    }
  }
  events(after = 0, limit = 50, types?: string[]): EventEntry[] { return this.eventEntries.filter(e => e.id > after && (!types?.length || types.includes(e.type))).slice(0, limit); }
  async close(): Promise<void> {}
}
