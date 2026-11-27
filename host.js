// Registers the Host adapter, user-facing commands, and the settings API.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BRIDGE_NAME, dataDirectory } from './storage.js';
import { AgyAdapter, normalizeSettings, readJson, writeJson } from './adapter.js';
import { MODES, failureOf, validateHiddenModels, visibleModels } from './model.js';
import { createPermissionBridge, createQuestionBridge } from './permission.js';

export const inject = ['llm', 'agents', 'workingDirectory', 'tools', 'commands', 'connection'];
const HEADERS = { 'cache-control': 'no-store' };
const wrongProvider = '请先将当前对话模型切换为 Google Antigravity CLI。';
const success = text => ({ kind: 'success', text });
const errorResult = text => ({ kind: 'error', text });
const usesAgy = agent => agent?.model.current()?.provider === 'agy';

export async function apply(ctx, config = {}) {
  const directory = await dataDirectory();
  const settingsFile = path.join(directory, 'settings.json');
  const settings = await readJson(settingsFile, config);
  const adapter = new AgyAdapter({
    directory, settings,
    records: await readJson(path.join(directory, 'sessions.json'), {}),
    getAgent: id => ctx.agents.get(id),
    cwdOf: agent => ctx.workingDirectory.get(agent.session),
    ask: createPermissionBridge(ctx),
    askUser: createQuestionBridge(ctx),
  });
  ctx.effect(() => () => adapter.dispose(), `${BRIDGE_NAME}: ACP process`);
  ctx.llm.registerAdapter(['agy'], adapter);

  // Restrict inherited tools on the individual Agent only. Agent-local tools
  // are exempt from DSH restrict(); guard them and never serialize a DSH tool
  // schema or yield a DSH tool-call from ACP.
  const masks = new Map();
  function syncTools(agent) {
    const previous = masks.get(agent);
    if (!usesAgy(agent)) {
      masks.delete(agent);
      if (previous) void previous();
      return;
    }
    if (previous) return;
    const off = agent.ctx.effect(() => {
      const restrict = agent.ctx.tools.restrict({ allow: [] });
      const guard = agent.ctx.tools.guard(() => 'DSH tools are unavailable on the agy provider.');
      return () => { restrict(); guard(); };
    }, `${BRIDGE_NAME}: no DSH tools on this Agent`);
    masks.set(agent, off);
  }
  for (const agent of ctx.agents.list()) syncTools(agent);
  ctx.on('agent/created', ({ agent }) => { syncTools(agent); });
  ctx.on('agent/disposed', ({ agent }) => { masks.delete(agent); adapter.interjecting.delete(agent.id); });
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message.source?.kind !== 'user') return;
    if (!adapter.steer(agent.id, message)) adapter.interrupt(agent.id);
  });
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'model/selection') return;
    const agent = ctx.agents.get(session.id);
    if (agent) syncTools(agent);
  });
  ctx.effect(() => async () => { await Promise.all([...masks.values()].map(off => off())); masks.clear(); }, `${BRIDGE_NAME}: tool masks`);

  function register(name, description, action, hint) {
    ctx.effect(() => ctx.commands.register({ name, description, ...(hint ? { input: { hint } } : {}),
      handler: async args => {
        if (!usesAgy(args.agent)) return errorResult(wrongProvider);
        try { return await action(args); } catch (error) { return errorResult(failureOf(error).message); }
      },
    }), `${BRIDGE_NAME}: /${name}`);
  }
  const quota = async ({ signal }) => {
    signal.throwIfAborted();
    const rows = await adapter.quota();
    const labels = { gemini: 'Gemini', claudeGpt: 'Claude / GPT', fiveHours: '5 小时', week: '每周' };
    return success(rows.map(row => `${labels[row.group]} · ${labels[row.period]}：剩余 ${row.remaining}%（${new Date(row.resetAt).toLocaleString()} 重置，主机时区）`).join('\n'));
  };
  register('usage', '查看 Antigravity 的 5 小时和每周额度', quota);
  register('quota', '查看 Antigravity 额度（/usage 的别名）', quota);
  register('agy-mode', '查看或切换当前 Antigravity 会话模式', async ({ agent, rawInput, signal }) => {
    const requested = rawInput.trim();
    const value = requested ? await adapter.setMode(agent, requested, signal) : adapter.modeInfo(agent);
    return success(`当前 agy 模式：${value.mode ?? '由 CLI 决定（尚未启动）'}。可选：${value.modes.join(' / ')}`);
  }, MODES.join(' | '));
  register('agy', '查看或运行当前 Antigravity 会话公开的斜杠命令', async ({ agent, rawInput, signal }) => {
    const commands = await adapter.commands(agent, signal);
    const requested = rawInput.trim().replace(/^\//, '');
    if (!requested) return success(commands.length ? commands.map(command => `/${command.name} — ${command.description}`).join('\n') : 'agy 没有公布可转发的斜杠命令。');
    const name = requested.split(/\s/, 1)[0];
    if (!commands.some(command => command.name === name)) return errorResult(`agy 没有公布 /${name}；可以先输入 /agy 查看清单。`);
    signal.throwIfAborted();
    if (!usesAgy(agent)) return errorResult(wrongProvider);
    // Wake the DSH agent rather than sending an out-of-band ACP prompt: other plugins' injections,
    // conversation history, cancellation and approvals remain in play.
    agent.followup({ id: randomUUID(), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `/agy ${requested}` }] });
    return success(`已将 /${name} 加入对话队列。`);
  }, 'command [args]');

  let settingsWrite = Promise.resolve();
  // The browser reaches these as exact POST routes on the shared /api channel
  // (`rpc.call('/api', 'dsh-agy-bridge.<name>', payload)`), the same wire shape
  // dsh-plugin-subscriptions uses, so they also work from the desktop shell.
  const answer = (rpcId, result) => Response.json({ type: 'server-response', rpcId, result }, { headers: HEADERS });
  const mount = (suffix, handle) => {
    const method = `${BRIDGE_NAME}.${suffix}`;
    ctx.effect(() => ctx.connection.fetch.register({
      path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        const admission = ctx.connection.admit(request);
        if (admission.rejection || admission.peer.principal.kind !== 'owner') return new Response('forbidden', { status: admission.rejection ?? 403 });
        let envelope;
        try { envelope = await request.json(); } catch { return new Response('body is not JSON', { status: 400 }); }
        if (envelope?.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.method !== method) return new Response('bad request', { status: 400 });
        try { return answer(envelope.rpcId, { ok: true, value: await handle(envelope.payload ?? {}, request.signal) }); }
        catch (error) { return answer(envelope.rpcId, { ok: false, error: failureOf(error) }); }
      },
    }), `${BRIDGE_NAME}: ${suffix} route`);
  };
  let cachedVersion, cachedQuota;
  function panelModels() {
    const families = adapter.modelCache;
    if (!families) return undefined;
    const visible = new Set(visibleModels(families, adapter.settings.hiddenModels).map(model => model.id));
    return { updatedAt: adapter.modelUpdatedAt, value: families.map(({ id, name, levels }) => ({ id, name, levels, visible: visible.has(id) })) };
  }
  mount('status', () => ({
    settings: adapter.settings, process: adapter.processState, resolvedExecutable: adapter.binary(),
    version: cachedVersion ?? null, quota: cachedQuota ?? null, models: panelModels() ?? null,
  }));
  mount('version', async () => {
    const executable = adapter.binary();
    const item = { value: await adapter.version(), updatedAt: Date.now() };
    if (executable === adapter.binary()) cachedVersion = item;
    return item;
  });
  mount('quota', async () => {
    const executable = adapter.binary();
    const item = { value: await adapter.quota(), updatedAt: Date.now() };
    if (executable === adapter.binary()) cachedQuota = item;
    return item;
  });
  mount('models', async () => {
    await adapter.getModelFamilies(true);
    const models = panelModels();
    if (!models) throw new Error('agy 模型目录已切换，请刷新。');
    return models;
  });
  mount('settings', async input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置必须是对象。');
    const change = settingsWrite.then(async () => {
      const next = normalizeSettings({ ...adapter.settings, ...input });
      const visibilityChanged = Object.hasOwn(input, 'hiddenModels');
      const pathChanged = next.executable !== adapter.settings.executable;
      if (visibilityChanged) {
        if (pathChanged) throw new Error('请先保存 agy 路径，再调整模型显示。');
        validateHiddenModels(await adapter.getModelFamilies(), next.hiddenModels);
      }
      await adapter.configure(next, () => writeJson(settingsFile, next));
      if (pathChanged) cachedVersion = cachedQuota = undefined;
      if (pathChanged || visibilityChanged) ctx.emit('llm/models-updated', 'agy');
      return { settings: next };
    });
    settingsWrite = change.catch(() => {});
    return change;
  });
  mount('interject', async input => {
    const { sessionId, mode } = input;
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('请指定当前会话。');
    if (mode !== undefined) {
      if (!['queue', 'steer', 'cancel'].includes(mode)) throw new Error('插话方式必须是 queue、steer 或 cancel。');
      if (mode === 'queue') adapter.interjecting.delete(sessionId); else adapter.interjecting.set(sessionId, mode);
    }
    return { mode: adapter.interjecting.get(sessionId) ?? 'queue' };
  });
  mount('mode', async (input, signal) => {
    const controller = ctx.get('sessionController');
    if (input.mode === undefined) {
      const sessionId = input.sessionId;
      const agent = sessionId && ctx.agents.get(sessionId);
      if (agent || !sessionId || !controller) return adapter.modeInfo(agent || undefined);
      const state = await controller.projections({ sessionId }, signal);
      const selection = state?.values?.modelSelection;
      const current = selection?.next ?? selection?.lastUsed ?? ctx.get('agentDefaultModel')?.currentSelection();
      return adapter.modeInfo(undefined, current?.provider === 'agy', sessionId);
    }
    const { sessionId, mode } = input;
    if (typeof sessionId !== 'string' || !sessionId || !MODES.includes(mode)) throw new Error('请指定当前会话和有效的 agy 模式。');
    let agent = ctx.agents.get(sessionId);
    if (!agent && controller) {
      const state = await controller.projections({ sessionId }, signal);
      const selection = state?.values?.modelSelection;
      const current = selection?.next ?? selection?.lastUsed ?? ctx.get('agentDefaultModel')?.currentSelection();
      if (current?.provider === 'agy') {
        const resolved = await controller.resolveAgent(sessionId);
        if (resolved.error) throw resolved.error;
        agent = resolved.agent;
      }
    }
    if (!usesAgy(agent)) throw new Error(wrongProvider);
    return adapter.setMode(agent, mode, signal);
  });
}
