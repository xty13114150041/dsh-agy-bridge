// Antigravity ACP is newline-delimited JSON-RPC 2.0 on stdio.
import { spawn, execFile } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export function runAgy(file, args, options = {}) {
  return exec(file, args, { cwd: tmpdir(), timeout: 20_000, maxBuffer: 1024 * 1024, ...options })
    .then(({ stdout }) => stdout.trim(), cause => {
      const info = String(cause.stderr || cause.stdout || '').trim();
      if (info) throw new Error(`agy ${args[0]}: ${info}`, { cause });
      throw cause;
    });
}

export function frameReader(accept) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return bytes => {
    pending += decoder.write(bytes);
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) accept(JSON.parse(line));
    }
  };
}

export class AcpError extends Error {
  constructor(error) {
    super(error.message);
    this.rpcCode = error.code;
    this.data = error.data;
  }
}

export class AcpClient {
  nextId = 0;
  pending = new Map();
  listeners = new Map();
  sessionInfo = new Map();
  onPermission = new Map();
  onElicit = new Map();
  stderr = '';
  failure = null;

  constructor(file, { cwd = tmpdir() } = {}) {
    this.child = spawn(file, ['acp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const read = frameReader(frame => this.receive(frame));
    this.child.stdout.on('data', bytes => {
      try { read(bytes); } catch (cause) { this.dispose(Object.assign(new Error('agy ACP returned an invalid JSON-RPC frame', { cause }), { code: 'MALFORMED_RESPONSE' })); }
    });
    this.child.stderr.setEncoding('utf8').on('data', text => { this.stderr = (this.stderr + text).slice(-1200); });
    this.child.on('error', cause => this.dispose(Object.assign(new Error(`Cannot start agy: ${cause.message}`, { cause }), {
      code: cause.code === 'ENOENT' || cause.code === 'EACCES' ? 'INVALID_CONFIG' : 'TRANSPORT',
    })));
    this.child.stdin.on('error', cause => this.dispose(Object.assign(new Error('agy ACP input closed', { cause }), { code: 'TRANSPORT' })));
    this.closed = new Promise(resolve => this.child.once('close', (code, signal) => {
      this.dispose(Object.assign(new Error(`agy ACP exited (${signal ?? code})${this.stderr.trim() ? `: ${this.stderr.trim()}` : ''}`), { code: 'TRANSPORT' }));
      resolve();
    }));
  }

  dispose(error = Object.assign(new Error('agy ACP closed'), { code: 'TRANSPORT' })) {
    if (!this.failure) {
      this.failure = error;
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
      this.listeners.clear();
      this.sessionInfo.clear();
      this.onPermission.clear();
      this.onElicit.clear();
      if (this.child.pid && this.child.exitCode === null && this.child.signalCode === null) {
        this.child.kill('SIGTERM');
        const kill = setTimeout(() => this.child.kill('SIGKILL'), 1500);
        kill.unref();
        this.closed.then(() => clearTimeout(kill));
      }
    }
    return this.closed;
  }

  async initialize() {
    const result = await this.request('initialize', { protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } } });
    if (result.protocolVersion !== 1) throw new Error(`agy ACP protocol version ${result.protocolVersion} is unsupported`);
    this.capabilities = result.agentCapabilities ?? {};
    return result;
  }

  write(frame) {
    if (this.failure) throw this.failure;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n');
  }

  notify(method, params) { this.write({ method, params }); }

  request(method, params, timeout = 20_000) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = timeout && setTimeout(() => {
        this.dispose(Object.assign(new Error(`agy ACP ${method} timed out`), { code: 'TIMEOUT' }));
      }, timeout);
      const settle = fn => value => { clearTimeout(timer); this.pending.delete(id); fn(value); };
      const entry = { resolve: settle(resolve), reject: settle(reject) };
      this.pending.set(id, entry);
      try { this.write({ id, method, params }); } catch (error) { entry.reject(error); }
    });
  }

  subscribe(id, listener) {
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    const listeners = this.listeners.get(id);
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); };
  }

  receive(frame) {
    if (frame?.jsonrpc !== '2.0') throw new Error('Unexpected ACP envelope');
    if (frame.method) {
      if (Object.hasOwn(frame, 'id')) void this.answerRequest(frame);
      else if (frame.method === 'session/update') {
        const { sessionId, update } = frame.params;
        const meta = this.sessionInfo.get(sessionId) ?? {};
        if (update.sessionUpdate === 'available_commands_update') meta.commands = update.availableCommands;
        if (update.sessionUpdate === 'current_mode_update') meta.mode = update.currentModeId;
        if (update.sessionUpdate === 'config_option_update') {
          const mode = update.configOptions?.find(o => o.id === 'mode');
          if (mode?.currentValue) meta.mode = mode.currentValue;
        }
        this.sessionInfo.set(sessionId, meta);
        for (const listener of this.listeners.get(sessionId) ?? []) listener(update);
      }
      return;
    }
    const entry = this.pending.get(frame.id);
    if (entry) {
      if (frame.error) entry.reject(new AcpError(frame.error));
      else if (Object.hasOwn(frame, 'result')) entry.resolve(frame.result);
      else throw new Error('ACP reply lacks result or error');
    }
  }

  async answerRequest({ id, method, params }) {
    let reply;
    try {
      if (method === 'elicitation/create') {
        const choose = this.onElicit.get(params.sessionId);
        reply = { result: choose ? await choose(params) : { action: 'cancel' } };
      } else if (method !== 'session/request_permission') {
        reply = { error: { code: -32601, message: `ACP client does not implement ${method}` } };
      } else {
        const choose = this.onPermission.get(params.sessionId);
        const outcome = choose ? await choose(params) : { outcome: 'cancelled' };
        reply = { result: { outcome } };
      }
    } catch (error) {
      reply = { error: { code: -32603, message: `ACP client failed to answer ${method}: ${error.message}` } };
    }
    if (!this.failure) {
      try { this.write({ id, ...reply }); }
      catch (error) { this.dispose(error); }
    }
  }
}

const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cachedReadTokens', 'cachedWriteTokens', 'thoughtTokens', 'totalTokens'];
export function addUsage(a, b) {
  if (!a || !b) return a ?? b;
  return Object.fromEntries(USAGE_FIELDS.filter(key => Number.isFinite(a[key]) || Number.isFinite(b[key])).map(key => [key, (a[key] ?? 0) + (b[key] ?? 0)]));
}

// Track updates and keep the session reserved until agy acknowledges cancellation.
export async function prompt(client, sessionId, blocks, { signal, update, permission, elicit, steers } = {}) {
  signal?.throwIfAborted();
  const lifetime = new AbortController();
  const off = client.subscribe(sessionId, update ?? (() => {}));
  const cancelled = { outcome: 'cancelled' };
  let settlePermission, settleElicit;
  const permissionAborted = new Promise(resolve => { settlePermission = resolve; });
  const elicitAborted = new Promise(resolve => { settleElicit = resolve; });
  const declined = { action: 'cancel' };
  client.onPermission.set(sessionId, params => lifetime.signal.aborted ? cancelled : Promise.race([
    Promise.resolve().then(() => permission?.(params, lifetime.signal) ?? cancelled), permissionAborted,
  ]));
  client.onElicit.set(sessionId, params => lifetime.signal.aborted ? declined : Promise.race([
    Promise.resolve().then(() => elicit?.(params, lifetime.signal) ?? declined), elicitAborted,
  ]));
  let timer;
  const cancel = () => {
    if (!client.failure) {
      try {
        client.notify('session/cancel', { sessionId });
        timer = setTimeout(() => client.dispose(Object.assign(new Error('agy ACP did not acknowledge cancellation'), { code: 'TIMEOUT' })), 5000);
      } catch (error) { client.dispose(error); }
    }
    lifetime.abort();
    settlePermission(cancelled);
    settleElicit(declined);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    let result = await client.request('session/prompt', { sessionId, prompt: blocks }, 0);
    // A steered message becomes the turn's new owner: this prompt answers at once and the last steer ends the turn.
    // Each prompt reports only the model requests it ran, so the turn's usage is their sum.
    let usage = result.usage;
    while (steers?.length) {
      const next = await steers.shift();
      if (!next) continue;
      result = next;
      usage = addUsage(usage, next.usage);
    }
    if (steers) steers.closed = true;
    return usage ? { ...result, usage } : result;
  } finally {
    if (steers) steers.closed = true;
    clearTimeout(timer);
    lifetime.abort();
    settlePermission(cancelled);
    settleElicit(declined);
    signal?.removeEventListener('abort', cancel);
    client.onPermission.delete(sessionId);
    client.onElicit.delete(sessionId);
    off();
  }
}

export const textBlock = text => ({ type: 'text', text });
