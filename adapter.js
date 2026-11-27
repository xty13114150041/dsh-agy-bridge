// Process and per-session mappings. No DSH packages are needed to drive ACP.
import { accessSync, constants } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { AcpClient, prompt, runAgy, textBlock } from './acp.js';
import { MODES, PROVIDER_NAME, failureOf, elicitationQuestions, elicitationResult, messageText, modelRoute, parseModels, parseQuota, permissionDescription, planPrompt, tokenUsage, visibleModels } from './model.js';

const abortFinish = () => ({ kind: 'aborted', failure: { code: 'ABORTED', message: 'agy request cancelled' } });
const errorFinish = (code, message) => ({ kind: 'error', failure: { code, message } });
const invalid = message => Object.assign(new Error(message), { code: 'INVALID_REQUEST' });
const defaultBinary = path.join(homedir(), '.local/bin/agy');

export function normalizeExecutable(value = '') {
  if (typeof value !== 'string') throw invalid('agy executable path must be a string');
  const file = value.trim().replace(/^~\//, `${homedir()}/`);
  if (file && !path.isAbsolute(file)) throw invalid('请输入 agy 的绝对路径，或留空自动探测。');
  return file;
}

export function normalizeSettings({ executable, showToolActivity = true, hiddenModels = [] } = {}) {
  if (typeof showToolActivity !== 'boolean') throw invalid('工具活动开关必须为布尔值。');
  if (!Array.isArray(hiddenModels) || hiddenModels.some(id => typeof id !== 'string' || !id)) throw invalid('隐藏模型清单无效。');
  return { executable: normalizeExecutable(executable), showToolActivity, hiddenModels: [...new Set(hiddenModels)] };
}

export async function readJson(file, empty) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return empty; throw error; }
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(file + '.tmp', file);
}

export class AgyAdapter {
  client = null;
  starting = null;
  records = new Map();
  queues = new Map();
  modeWrites = new Map();
  active = new Map();
  interrupts = new Map();
  interjecting = new Map();
  turns = new Map();
  opened = new Map();
  modelCache = null;
  modelUpdatedAt = null;
  modelLookup = null;
  saveQueue = Promise.resolve();
  disposed = false;

  constructor({ directory, settings, records, getAgent, cwdOf, ask, askUser }) {
    this.mappingFile = path.join(directory, 'sessions.json');
    this.settings = normalizeSettings(settings);
    this.records = new Map(Object.entries(records));
    this.getAgent = getAgent;
    this.cwdOf = cwdOf;
    this.ask = ask;
    this.askUser = askUser;
  }

  binary() {
    if (this.settings.executable) return this.settings.executable;
    try { accessSync(defaultBinary, constants.X_OK); return defaultBinary; }
    catch { return 'agy'; }
  }

  async configure(settings, save) {
    const pathChanged = settings.executable !== this.settings.executable;
    if (pathChanged && (this.queues.size || this.modeWrites.size || this.active.size)) {
      throw invalid('agy 正在处理请求，请等当前操作结束后再修改路径。');
    }
    if (pathChanged) await this.resetClient();
    await save();
    this.settings = settings;
    if (pathChanged) {
      this.modelCache = null;
      this.modelUpdatedAt = null;
      this.modelLookup = null;
    }
  }

  get processState() { return this.starting ? 'starting' : !this.client ? 'idle' : this.client.failure ? 'stopped' : 'running'; }

  async resetClient() {
    const old = this.client;
    this.client = null;
    this.starting = null;
    this.opened.clear();
    await old?.dispose();
  }

  async dispose() {
    this.disposed = true;
    await this.resetClient();
    await this.saveQueue;
  }

  async acquire() {
    if (this.disposed) throw invalid('agy 插件已卸载。');
    if (this.starting) return this.starting;
    if (this.client && !this.client.failure) return this.client;
    this.opened.clear();
    const client = new AcpClient(this.binary());
    this.client = client;
    const start = client.initialize().then(() => client, async error => { await client.dispose(error); throw error; });
    this.starting = start;
    try { return await start; }
    finally { if (this.starting === start) this.starting = null; }
  }

  save(key, patch) {
    const next = { ...this.records.get(key), ...patch };
    this.records.set(key, next);
    const pending = this.saveQueue.then(() => writeJson(this.mappingFile, Object.fromEntries(this.records)));
    this.saveQueue = pending.catch(() => {});
    return pending;
  }

  lock(key, run) {
    const pending = (this.queues.get(key) ?? Promise.resolve()).then(run);
    const settled = pending.catch(() => {}).finally(() => { if (this.queues.get(key) === settled) this.queues.delete(key); });
    this.queues.set(key, settled);
    return pending;
  }

  providerInfo(provider) { return { id: provider, name: PROVIDER_NAME }; }
  providerRetryPolicy() { return undefined; }
  imageRequestPricing() { return undefined; }
  imageRequestTarget(_provider, _model, { width, height, bytes }) { return { width, height, maxBytes: bytes }; }

  // Interjection while agy is answering: 'cancel' cancels the turn so the queued DSH message goes out at once.
  interrupt(id) {
    const controller = this.interjecting.get(id) === 'cancel' && this.interrupts.get(id);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  // 'steer' sends the message into the running turn as a second prompt (agy >= 1.5.0). The running tool keeps going;
  // agy handles the message once it is done. Returns false when the message must simply queue instead.
  steer(id, message) {
    const turn = this.interjecting.get(id) === 'steer' && this.turns.get(id);
    const text = messageText(message).trim();
    if (!turn || !text || !message.id || turn.asking || turn.steers.closed || turn.steered.has(message.id)) return false;
    turn.steered.add(message.id);
    turn.note('- ↪ 新消息已并入当前回合，agy 完成手头的步骤后处理');
    turn.steers.push(turn.client.request('session/prompt', { sessionId: turn.sessionId, prompt: [textBlock(text)] }, 0).catch(() => {
      // agy turned it down (for example while waiting for an approval): leave it to DSH's normal queue.
      turn.steered.delete(message.id);
      turn.note('- 新消息未能并入当前回合，已改为排队');
    }));
    return true;
  }

  async getModelFamilies(refresh = false) {
    if (this.modelLookup) return this.modelLookup;
    if (!refresh && this.modelCache) return this.modelCache;
    const executable = this.binary();
    const pending = runAgy(executable, ['models']).then(parseModels).then(list => {
      if (this.binary() === executable) {
        this.modelCache = list;
        this.modelUpdatedAt = Date.now();
      }
      return list;
    });
    this.modelLookup = pending;
    try { return await pending; }
    finally { if (this.modelLookup === pending) this.modelLookup = null; }
  }

  async listModels(provider) {
    const families = await this.getModelFamilies();
    return visibleModels(families, this.settings.hiddenModels).map(({ id, name }) => ({ provider, id, name, inputModalities: ['text'] }));
  }

  async resolveModel(provider, model, signal) {
    signal?.throwIfAborted();
    const families = await this.getModelFamilies();
    signal?.throwIfAborted();
    return modelRoute(families, model).info(provider);
  }

  async prepareCall(provider, model, signal) {
    signal?.throwIfAborted();
    const families = await this.getModelFamilies();
    signal?.throwIfAborted();
    const route = modelRoute(families, model);
    return { model: route.info(provider), stream: options => this.stream(options, route) };
  }

  quota(cwd) { return runAgy(this.binary(), ['-p', '/usage'], cwd ? { cwd } : undefined).then(parseQuota); }
  version() { return runAgy(this.binary(), ['--version']); }

  async open(client, cwd, record, reuse, signal) {
    signal?.throwIfAborted();
    const existing = record?.sessionId && this.opened.get(record.sessionId);
    if (reuse && existing) return existing;
    const params = { cwd, mcpServers: [] };
    let result;
    if (reuse && record?.sessionId) {
      if (!client.capabilities.sessionCapabilities?.resume) throw invalid('此 agy 版本不支持 ACP session/resume。');
      try { result = await client.request('session/resume', { sessionId: record.sessionId, ...params }); }
      catch (error) {
        if (error.rpcCode !== -32002) throw error;
        // ACP explicitly reported that the old session no longer exists. The caller must replay.
        return null;
      }
    } else {
      if (existing) await this.close(client, existing.id);
      result = await client.request('session/new', params);
    }
    const id = reuse && record?.sessionId ? record.sessionId : result.sessionId;
    const meta = client.sessionInfo.get(id) ?? {};
    client.sessionInfo.set(id, meta);
    meta.mode ??= result.modes?.currentModeId ?? result.configOptions?.find(o => o.id === 'mode')?.currentValue;
    const session = { id, model: result.models?.currentModelId, modes: result.modes?.availableModes?.map(mode => mode.id) ?? MODES };
    this.opened.set(id, session);
    if (record?.mode && record.mode !== meta.mode) await this.setAcpMode(client, session, record.mode);
    return session;
  }

  async close(client, sessionId) {
    if (!client.failure) {
      if (!client.capabilities.sessionCapabilities?.close) throw invalid('此 agy 版本不支持 ACP session/close。');
      try { await client.request('session/close', { sessionId }, 5000); }
      catch (error) { if (error.rpcCode !== -32002) throw error; }
    }
    this.opened.delete(sessionId);
    client.sessionInfo.delete(sessionId);
  }

  async setAcpMode(client, session, mode) {
    if (!session.modes.includes(mode)) throw invalid(`agy 当前会话不支持模式：${mode}`);
    await client.request('session/set_mode', { sessionId: session.id, modeId: mode });
    const meta = client.sessionInfo.get(session.id) ?? {};
    client.sessionInfo.set(session.id, meta);
    meta.mode = mode;
  }

  modeInfo(agent, currentAgy = agent?.model.current()?.provider === 'agy', sessionKey = agent?.id) {
    if (!currentAgy) return { available: false };
    const record = this.records.get(sessionKey);
    const id = this.active.get(sessionKey)?.session?.id ?? record?.sessionId;
    const mode = this.client?.sessionInfo.get(id)?.mode ?? record?.mode ?? null;
    return { available: true, mode, modes: this.opened.get(id)?.modes ?? MODES, process: this.processState };
  }

  setMode(agent, mode, signal) {
    if (!MODES.includes(mode)) throw invalid(`用法：/agy-mode <${MODES.join('|')}>`);
    const change = (this.modeWrites.get(agent.id) ?? Promise.resolve()).then(async () => {
      signal?.throwIfAborted();
      if (agent.model.current()?.provider !== 'agy') throw invalid('请先将当前对话模型切换为 Google Antigravity CLI。');
      const active = this.active.get(agent.id);
      if (active?.session && !active.client.failure) {
        await this.setAcpMode(active.client, active.session, mode);
        await this.save(agent.id, { mode });
        return this.modeInfo(agent);
      }
      return this.lock(agent.id, async () => {
        const cwd = this.cwdOf(agent);
        const old = this.records.get(agent.id);
        const matching = old?.sessionId && old.cwd === cwd && old.executable === this.binary();
        const client = await this.acquire();
        let session = await this.open(client, cwd, matching ? old : undefined, !!matching, signal);
        const resumed = !!matching && !!session;
        if (!session) session = await this.open(client, cwd, undefined, false, signal);
        await this.setAcpMode(client, session, mode);
        await this.save(agent.id, { sessionId: session.id, cwd, executable: this.binary(), mode, ...resumed ? {} : { ids: [], last: '', dirty: false, reply: undefined } });
        return this.modeInfo(agent);
      });
    });
    const settled = change.catch(() => {}).finally(() => { if (this.modeWrites.get(agent.id) === settled) this.modeWrites.delete(agent.id); });
    this.modeWrites.set(agent.id, settled);
    return change;
  }

  async commands(agent, signal) {
    if (agent.model.current()?.provider !== 'agy') throw invalid('请先将当前对话模型切换为 Google Antigravity CLI。');
    return this.lock(agent.id, async () => {
      const cwd = this.cwdOf(agent);
      const old = this.records.get(agent.id);
      const matching = old?.sessionId && old.cwd === cwd && old.executable === this.binary();
      const client = await this.acquire();
      let session = await this.open(client, cwd, matching ? old : undefined, !!matching, signal);
      if (!session) session = await this.open(client, cwd, old ? { mode: old.mode } : undefined, false, signal);
      if (old?.sessionId !== session.id) await this.save(agent.id, { sessionId: session.id, cwd, executable: this.binary(), ids: [], last: '', dirty: false, reply: undefined });
      const commands = client.sessionInfo.get(session.id)?.commands;
      if (commands !== undefined) return commands;
      return new Promise((resolve, reject) => {
        const clear = () => { off(); clearTimeout(timer); signal?.removeEventListener('abort', abort); };
        const fail = message => { clear(); reject(invalid(message)); };
        const abort = () => fail('已取消读取 agy 命令。');
        const off = client.subscribe(session.id, update => {
          if (update.sessionUpdate === 'available_commands_update') { clear(); resolve(update.availableCommands); }
        });
        const timer = setTimeout(() => fail('agy 未公布会话命令列表，请先发送一条消息后再试。'), 3000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    });
  }

  async run(options, signal, emit, route) {
    signal.throwIfAborted();
    const resolved = route ?? modelRoute(await this.getModelFamilies(), options.model);
    const modelId = resolved.slug(options.reasoningEffort);
    const showToolActivity = this.settings.showToolActivity;
    const key = options.sessionId;
    const agent = key && this.getAgent(key);
    const auxiliary = !!options.purpose || !key;
    if (!auxiliary && !agent) throw invalid('无法找到对应的 DSH 会话工作目录。');
    const cwd = agent ? this.cwdOf(agent) : tmpdir();
    const old = auxiliary ? undefined : this.records.get(key);
    const matching = old?.sessionId && old.cwd === cwd && old.executable === this.binary();
    const plan = forceNew => planPrompt(options.messages, old, { purpose: options.purpose, system: options.system, forceNew });
    let request = plan(!matching);
    if (request.error) return errorFinish('INVALID_REQUEST', request.error);
    if (request.steered && !auxiliary) {
      // Everything new was already steered into the previous turn; there is nothing left to send.
      await this.save(key, { ...request.cursor, dirty: false, reply: undefined, steered: undefined });
      return { kind: 'stop' };
    }
    if (!request.text) return errorFinish('INVALID_REQUEST', '没有可发送给 agy 的新用户消息；未重复执行上一轮。');
    signal.throwIfAborted();
    const client = await this.acquire();
    let session = await this.open(client, cwd, auxiliary ? undefined : matching ? old : old ? { mode: old.mode } : undefined, request.reuse, signal);
    if (!session) {
      request = plan(true);
      if (request.error) return errorFinish('INVALID_REQUEST', request.error);
      session = await this.open(client, cwd, { mode: old?.mode }, false, signal);
    }
    if (!auxiliary) this.active.set(key, { client, session });
    else this.active.set(session.id, { client, session });
    const seen = new Map();
    let reply = '';
    let output = false;
    try {
      signal.throwIfAborted();
      if (session.model !== modelId) {
        await client.request('session/set_model', { sessionId: session.id, modelId });
        session.model = modelId;
      }
      signal.throwIfAborted();
      if (!auxiliary) await this.save(key, { sessionId: session.id, cwd, executable: this.binary(), ...request.cursor, dirty: true, reply: undefined });
      // Each run of thought, tool activity, or answer text becomes its own block, in arrival order.
      let kind;
      let index = -1;
      const open = next => { if (kind !== next) { kind = next; index += 1; return true; } return false; };
      const reasoning = text => { output = true; open('thought'); emit({ type: 'reasoning-delta', index, text }); };
      const toolNote = text => {
        output = true;
        const heading = open('tool') ? '**agy 工具**\n' : '';
        emit({ type: 'reasoning-delta', index, text: `${heading}${text}\n` });
      };
      const brief = value => {
        const line = String(value ?? '').split('\n')[0].trim();
        return line.length > 160 ? `${line.slice(0, 160)}…` : line;
      };
      let contextUsed;
      const interrupt = new AbortController();
      const turn = { client, sessionId: session.id, steers: [], steered: new Set(), asking: 0, note: toolNote };
      if (!auxiliary) { this.interrupts.set(key, interrupt); this.turns.set(key, turn); }
      const result = await prompt(client, session.id, [textBlock(request.text)], {
        signal: AbortSignal.any([signal, interrupt.signal]),
        steers: turn.steers,
        elicit: async (params, elicitSignal) => {
          const form = params.mode === 'form' || !params.mode ? elicitationQuestions(params) : undefined;
          if (!form || !this.askUser || auxiliary) return { action: 'decline' };
          turn.asking += 1;
          try {
            const answer = await this.askUser(agent, form.questions, elicitSignal);
            return answer ? elicitationResult(answer, form) : { action: 'decline' };
          } catch {
            return { action: 'cancel' };
          } finally { turn.asking -= 1; }
        },
        update(update) {
          const type = update.sessionUpdate;
          if (type === 'usage_update' && Number.isFinite(update.used)) contextUsed = update.used;
          if (type === 'agent_message_chunk' || type === 'agent_thought_chunk') {
            if (update.content?.type !== 'text' || !update.content.text) return;
            const { text } = update.content;
            output = true;
            if (type === 'agent_message_chunk') { reply += text; open('answer'); emit({ type: 'text-delta', index, text }); }
            else reasoning(text);
          }
          if (type === 'tool_call' || type === 'tool_call_update') {
            const { toolCallId, status } = update;
            const before = seen.get(toolCallId) ?? {};
            seen.set(toolCallId, { ...before, ...update });
            if (type === 'tool_call' || status && status !== before.status) {
              // A tool-only response is still a successful response when display is disabled.
              output = true;
              if (showToolActivity) {
                const title = update.title ?? before.title ?? update.name ?? before.name ?? toolCallId;
                // One line per tool; progress states only matter when something went wrong.
                if (type === 'tool_call') toolNote(`- \`${brief(title)}\``);
                else if (status === 'failed' || status === 'cancelled') toolNote(`- ✗ ${status === 'failed' ? '失败' : '已取消'}：\`${brief(title)}\``);
              }
            }
          }
        },
        permission: async ({ toolCall, options }, permissionSignal) => {
          const upstream = { ...seen.get(toolCall.toolCallId), ...toolCall };
          const { title, detail } = permissionDescription(upstream);
          if (permissionSignal.aborted) return { outcome: 'cancelled' };
          turn.asking += 1;
          try { return await (async () => {
          try {
            const decision = await this.ask(auxiliary ? undefined : agent, { title, detail, options, toolName: upstream.name }, permissionSignal);
            if (permissionSignal.aborted) return { outcome: 'cancelled' };
            if (decision) {
              if (decision.notice) toolNote(`- ${decision.notice}`);
              return decision.response;
            }
          } catch {
            if (permissionSignal.aborted) return { outcome: 'cancelled' };
          }
          const deny = options.find(o => o.kind === 'reject_once');
          toolNote(`- agy 请求权限：\`${brief(title)}\`。未收到许可，已拒绝；可在聊天中回答审批，或用 /agy-mode 查看其他 agy 模式。`);
          return deny ? { outcome: 'selected', optionId: deny.optionId } : { outcome: 'cancelled' };
          })(); } finally { turn.asking -= 1; }
        },
      });
      const interrupted = interrupt.signal.aborted && !signal.aborted && result.stopReason === 'cancelled';
      if (interrupted) toolNote('- ↯ 已被新消息打断');
      const usage = tokenUsage(result.usage, contextUsed);
      if (usage) emit({ type: 'usage', usage });
      // A normal stop lets DSH claim the queued message as the next step of this turn.
      if (interrupted) {
        if (!auxiliary) await this.save(key, { dirty: false, reply, steered: [...turn.steered] });
        return { kind: 'stop' };
      }
      if (signal.aborted || result.stopReason === 'cancelled') return abortFinish();
      if (result.stopReason === 'refusal') return errorFinish('CONTENT_REFUSED', 'agy refused the request');
      if (result.stopReason !== 'end_turn') return errorFinish('INVALID_RESPONSE', `agy stopped: ${result.stopReason}`);
      if (!output) return errorFinish('EMPTY_RESPONSE', 'agy 未返回内容。');
      if (!auxiliary) await this.save(key, { dirty: false, reply, steered: [...turn.steered] });
      return { kind: 'stop' };
    } finally {
      if (!auxiliary) { this.interrupts.delete(key); this.turns.delete(key); }
      this.active.delete(auxiliary ? session.id : key);
      if (auxiliary) await this.close(client, session.id);
    }
  }

  async *stream(options, route) {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const chunks = [];
    let wake;
    let finished = false;
    const emit = chunk => { chunks.push(chunk); wake?.(); };
    const run = () => this.run(options, signal, emit, route);
    const operation = options.sessionId && !options.purpose ? this.lock(options.sessionId, run) : run();
    const settled = operation.catch(error => signal.aborted ? abortFinish() : { kind: 'error', failure: failureOf(error) }).then(reason => {
      finished = true;
      emit({ type: 'finish', reason });
    });
    try {
      while (!finished || chunks.length) {
        if (!chunks.length) await new Promise(resolve => { wake = resolve; });
        wake = undefined;
        while (chunks.length) yield chunks.shift();
      }
    } finally {
      if (!finished) controller.abort();
      await settled;
    }
  }
}
