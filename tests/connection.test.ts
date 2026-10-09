import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readConfig } from '../src/config.js';
import { ObsConnection } from '../src/obs.js';

const hash = (s: string) => createHash('sha256').update(s).digest('base64');
async function mockServer(options: { password?: string; available?: string[]; omitReply?: string; errorOn?: string } = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const requests: any[] = [];
  let connections = 0;
  server.on('connection', socket => {
    connections++;
    socket.send(JSON.stringify({ op: 0, d: { obsStudioVersion: '32.1.2', obsWebSocketVersion: '5.6.3', rpcVersion: 1, ...(options.password ? { authentication: { salt: 'salt', challenge: 'challenge' } } : {}) } }));
    socket.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.op === 1) {
        if (options.password && m.d.authentication !== hash(hash(options.password + 'salt') + 'challenge')) { socket.close(4009, 'Authentication failed'); return; }
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        return;
      }
      if (m.op !== 6) return;
      requests.push(m.d);
      if (m.d.requestType === options.omitReply) return;
      const failed = m.d.requestType === options.errorOn;
      const data = m.d.requestType === 'GetVersion' ? { availableRequests: options.available ?? ['GetVersion', 'GetStats', 'GetSceneList', 'CreateScene'], obsVersion: '32.1.2' } : m.d.requestType === 'GetStats' ? { cpuUsage: 3 } : {};
      socket.send(JSON.stringify({ op: 7, d: { requestType: m.d.requestType, requestId: m.d.requestId, requestStatus: { result: !failed, code: failed ? 600 : 100, ...(failed ? { comment: 'Missing resource' } : {}) }, responseData: data } }));
    });
  });
  return { server, requests, url: `ws://127.0.0.1:${address.port}`, connections: () => connections, close: async () => { for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('authenticated concurrent requests share a single connection handshake', async () => {
  const mock = await mockServer({ password: 'test-password' });
  const obs = new ObsConnection(readConfig({ OBS_URL: mock.url, OBS_PASSWORD: 'test-password' }));
  try {
    await Promise.all([obs.request('GetStats'), obs.request('GetSceneList'), obs.request('GetStats')]);
    assert.equal(mock.connections(), 1);
    assert.equal(mock.requests.filter(r => r.requestType === 'GetVersion').length, 1);
  } finally { await obs.close(); await mock.close(); }
});
test('wrong authentication fails clearly and never sends an OBS command', async () => {
  const mock = await mockServer({ password: 'correct' });
  const obs = new ObsConnection(readConfig({ OBS_URL: mock.url, OBS_PASSWORD: 'wrong' }));
  try { await assert.rejects(obs.request('CreateScene', { sceneName: 'x' }), (e: any) => e.code === 4009); assert.equal(mock.requests.length, 0); }
  finally { await obs.close(); await mock.close(); }
});
test('unsupported and invalid requests are rejected before dispatch', async () => {
  const mock = await mockServer({ available: ['GetVersion'] });
  const obs = new ObsConnection(readConfig({ OBS_URL: mock.url }));
  try {
    await assert.rejects(obs.request('CreateScene', {}), (e: any) => e.code === 'INVALID_ARGUMENTS');
    assert.equal(mock.connections(), 0);
    await assert.rejects(obs.request('GetStats'), (e: any) => e.code === 'UNSUPPORTED_REQUEST');
    assert.deepEqual(mock.requests.map(r => r.requestType), ['GetVersion']);
  } finally { await obs.close(); await mock.close(); }
});
test('events retain bounded history, filter by type and continue with cursor', async () => {
  const mock = await mockServer();
  const obs = new ObsConnection(readConfig({ OBS_URL: mock.url, OBS_EVENT_BUFFER_SIZE: '2' }));
  try {
    await obs.request('GetVersion');
    const socket = [...mock.server.clients][0]!;
    for (let i = 0; i < 3; i++) socket.send(JSON.stringify({ op: 5, d: { eventType: 'RecordStateChanged', eventIntent: 64, eventData: { outputActive: true, outputState: String(i) } } }));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(obs.events().map(e => e.id), [2, 3]);
    assert.equal(obs.events(2, 50, ['RecordStateChanged']).length, 1);
    assert.equal(obs.events(0, 50, ['SceneCreated']).length, 0);
  } finally { await obs.close(); await mock.close(); }
});
test('timed-out mutation is sent once and reports an uncertain outcome', async () => {
  const mock = await mockServer({ omitReply: 'CreateScene' });
  const obs = new ObsConnection(readConfig({ OBS_URL: mock.url, OBS_TIMEOUT_MS: '1000' }));
  try {
    await assert.rejects(obs.request('CreateScene', { sceneName: 'x' }), (e: any) => e.code === 'OBS_TIMEOUT' && /outcome may be unknown/.test(e.message));
    assert.equal(mock.requests.filter(r => r.requestType === 'CreateScene').length, 1);
  } finally { await obs.close(); await mock.close(); }
});
test('a subsequent request reconnects after a lost connection without replaying the previous change', async () => {
  const mock = await mockServer();
  const obs = new ObsConnection(readConfig({ OBS_URL: mock.url }));
  try {
    await obs.request('CreateScene', { sceneName: 'once' });
    [...mock.server.clients][0]!.close();
    await new Promise(resolve => setTimeout(resolve, 30));
    await obs.request('GetStats');
    assert.equal(mock.connections(), 2);
    assert.equal(mock.requests.filter(r => r.requestType === 'CreateScene').length, 1);
  } finally { await obs.close(); await mock.close(); }
});
test('stdio launcher negotiates MCP even with OBS offline, then reports errors as tool results', async () => {
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/cli.ts'], cwd: process.cwd(), env: { ...process.env, OBS_URL: 'ws://127.0.0.1:1', OBS_TIMEOUT_MS: '1000' }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.length > 80);
    const result = await client.callTool({ name: 'obs_request', arguments: { requestType: 'GetVersion' } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /OBS_UNAVAILABLE/);
  } finally { await client.close(); }
});
test('stdin EOF closes an authenticated OBS socket and exits without a termination signal', async () => {
  const mock = await mockServer();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts'], { cwd: process.cwd(), env: { ...process.env, OBS_URL: mock.url }, stdio: ['pipe', 'pipe', 'pipe'] });
  const reader = createInterface({ input: child.stdout });
  const pending = new Map<number, (message: any) => void>();
  reader.on('line', line => { const m = JSON.parse(line); pending.get(m.id)?.(m); });
  const send = (id: number, method: string, params: unknown) => new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`No response to ${method}`)), 5000);
    pending.set(id, message => { clearTimeout(timeout); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'eof-test', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const result = await send(2, 'tools/call', { name: 'obs_request', arguments: { requestType: 'GetStats' } });
    assert.equal(result.result.isError, undefined); assert.equal(mock.server.clients.size, 1);
    const exited = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server remained alive after stdin EOF')), 2000);
      child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Exit code ${code}`)); });
    });
    child.stdin.end(); await exited;
    assert.equal(mock.server.clients.size, 0);
  } finally { reader.close(); if (child.exitCode === null) child.kill(); await mock.close(); }
});
