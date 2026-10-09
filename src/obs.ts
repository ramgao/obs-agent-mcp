import OBSWebSocket, { EventSubscription } from 'obs-websocket-js/json';
import type { Config } from './config.js';
import { AgentError, redact } from './errors.js';
import { validateRequest, type JsonObject } from './catalog.js';
import eventTypes from './event-types.json' with { type: 'json' };

export interface EventEntry { id: number; time: string; type: string; data: unknown }
export interface ObsApi {
  config: Config;
  request(name: string, data?: JsonObject): Promise<JsonObject>;
  events(after?: number, limit?: number, types?: string[]): EventEntry[];
  close(): Promise<void>;
}

export class ObsConnection implements ObsApi {
  private socket = new OBSWebSocket();
  private connecting?: Promise<void>;
  private connected = false;
  private available = new Set<string>();
  private buffer: EventEntry[] = [];
  private eventId = 0;
  private closed = false;
  constructor(public readonly config: Config) {
    this.socket.on('ConnectionClosed', () => { this.connected = false; this.available.clear(); });
    // Prevent unhandled emitter errors. Individual connection/call promises report failures.
    this.socket.on('ConnectionError', () => {});
    const on = this.socket.on.bind(this.socket) as (type: string, listener: (data: unknown) => void) => unknown;
    for (const type of eventTypes) on(type, data => {
      this.buffer.push({ id: ++this.eventId, time: new Date().toISOString(), type, data: redact(data, config.password) });
      if (this.buffer.length > config.eventBufferSize) this.buffer.shift();
    });
  }

  private async deadline<T>(promise: Promise<T>, operation: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AgentError('OBS_TIMEOUT', `${operation} timed out. Its outcome may be unknown; inspect OBS before repeating a change.`)), this.config.timeoutMs);
      })]);
    } catch (error) {
      if (error instanceof AgentError && error.code === 'OBS_TIMEOUT') await this.socket.disconnect().catch(() => {});
      throw error;
    } finally { clearTimeout(timer); }
  }

  private async connect(): Promise<void> {
    if (this.closed) throw new AgentError('CLOSED', 'The OBS connection has been shut down.');
    if (this.connected) return;
    if (!this.connecting) {
      this.connecting = (async () => {
        try {
          await this.deadline(this.socket.connect(this.config.url, this.config.password, { rpcVersion: 1, eventSubscriptions: EventSubscription.All }), 'Connection');
          const version = await this.deadline(this.socket.call('GetVersion'), 'GetVersion');
          this.available = new Set(version.availableRequests);
          this.connected = true;
        } catch (error) {
          this.connected = false;
          await this.socket.disconnect().catch(() => {});
          const e = error as { code?: number };
          if (e.code === 4009 || error instanceof AgentError) throw error;
          throw new AgentError('OBS_UNAVAILABLE', 'Cannot connect to OBS. Open OBS and enable Tools > WebSocket Server Settings. Check OBS_URL and OBS_PASSWORD.');
        }
      })().finally(() => { this.connecting = undefined; });
    }
    await this.connecting;
  }

  async request(name: string, data: JsonObject = {}): Promise<JsonObject> {
    validateRequest(name, data, this.config.readOnly);
    await this.connect();
    if (!this.available.has(name)) throw new AgentError('UNSUPPORTED_REQUEST', `${name} is not supported by this OBS version. Update OBS or choose a supported request.`);
    // Never replay a mutation automatically after a disconnect or timeout.
    const call = this.socket.call as (name: string, data: JsonObject) => Promise<JsonObject>;
    // OBS accepts forward slashes on Windows; this also avoids configuration
    // escaping differences between OBS releases for recording directories.
    const payload = name === 'SetRecordDirectory' && typeof data.recordDirectory === 'string' && /^(?:[a-z]:[\\/]|\\\\)/i.test(data.recordDirectory)
      ? { ...data, recordDirectory: data.recordDirectory.replaceAll('\\', '/') } : data;
    return (await this.deadline(call.call(this.socket, name, payload), name)) ?? {};
  }

  events(after = 0, limit = 50, types?: string[]): EventEntry[] {
    return this.buffer.filter(e => e.id > after && (!types?.length || types.includes(e.type))).slice(0, limit);
  }
  async close(): Promise<void> { this.closed = true; await this.socket.disconnect().catch(() => {}); }
}
