export class AgentError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'AgentError';
  }
}

// OBS stream settings, plugin data and errors must not leak credentials to the AI.
const secretKey = /^(password|passwd|secret|token|accessToken|refreshToken|apiKey|streamKey|key|authorization)$/i;
export function redact(value: unknown, password?: string): unknown {
  if (typeof value === 'string') return password ? value.split(password).join('[REDACTED]') : value;
  if (Array.isArray(value)) return value.map(v => redact(v, password));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, secretKey.test(k) ? '[REDACTED]' : redact(v, password)]));
  }
  return value;
}

export function errorInfo(error: unknown, password?: string): { code: string; message: string; details?: unknown } {
  if (error instanceof AgentError) return redact({ code: error.code, message: error.message, details: error.details }, password) as ReturnType<typeof errorInfo>;
  const e = error as { code?: number; message?: string };
  const labels: Record<number, string> = { 204: 'Unknown OBS request.', 300: 'Missing required argument.', 400: 'Invalid argument.', 401: 'Wrong argument type.', 402: 'Argument is outside the allowed range.', 403: 'Argument cannot be empty.', 404: 'Conflicting arguments.', 500: 'Output is already running.', 501: 'Output is not running.', 502: 'Output is paused.', 503: 'Output has not entered the paused state.', 504: 'Output is disabled.', 505: 'Studio Mode is already active.', 506: 'Studio Mode is not active.', 600: 'Resource was not found.', 601: 'Resource already exists.', 604: 'Resource is unavailable in its current state.', 605: 'Input kind is invalid.', 606: 'Resource cannot be configured.', 700: 'OBS could not create the resource.', 701: 'OBS could not complete the action.', 702: 'OBS could not process the request.', 703: 'These arguments cannot be used together.' };
  const hint = e?.code === 4009 ? ' Authentication failed. Check OBS_PASSWORD against Tools > WebSocket Server Settings.'
    : e?.code === 600 ? ' The requested scene, source or item does not exist. Inspect OBS first.'
    : e?.code === 500 ? ' Stop the active output before changing this setting.'
    : e?.code === 501 ? ' Start the output before using this operation.' : '';
  const message = e?.message?.trim() || (e?.code ? labels[e.code] ?? `OBS request failed with code ${e.code}.` : 'Unexpected error.');
  return redact({ code: e?.code ? `OBS_${e.code}` : 'INTERNAL_ERROR', message: message + hint }, password) as ReturnType<typeof errorInfo>;
}
