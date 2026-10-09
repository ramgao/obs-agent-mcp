export interface Config {
  url: string;
  password?: string;
  mode: 'curated' | 'full';
  readOnly: boolean;
  timeoutMs: number;
  eventBufferSize: number;
}

function integer(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return n;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.OBS_URL ?? 'ws://127.0.0.1:4455';
  const parsed = new URL(url);
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('OBS_URL must be a ws:// or wss:// URL without embedded credentials. Use OBS_PASSWORD.');
  }
  const mode = env.OBS_TOOL_MODE ?? 'curated';
  if (mode !== 'curated' && mode !== 'full') throw new Error('OBS_TOOL_MODE must be curated or full.');
  const flag = env.OBS_READ_ONLY ?? 'false';
  if (flag !== 'true' && flag !== 'false') throw new Error('OBS_READ_ONLY must be true or false.');
  return {
    url, password: env.OBS_PASSWORD, mode, readOnly: flag === 'true',
    timeoutMs: integer(env.OBS_TIMEOUT_MS, 10000, 1000, 60000, 'OBS_TIMEOUT_MS'),
    eventBufferSize: integer(env.OBS_EVENT_BUFFER_SIZE, 200, 1, 2000, 'OBS_EVENT_BUFFER_SIZE'),
  };
}
