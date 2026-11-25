// Registers the Host adapter, user-facing commands, and the settings API.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { BRIDGE_NAME, dataDirectory } from './storage.js';
import { AgyAdapter, normalizeSettings, readJson, writeJson } from './adapter.js';
import { MODES, failureOf, validateHiddenModels, visibleModels } from './model.js';
import { createPermissionBridge } from './permission.js';

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
  ctx.on('agent/disposed', ({ agent }) => { masks.delete(agent); });
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
  const json = (value, status = 200) => Response.json(value, { status, headers: HEADERS });
  const mount = (suffix, methods, handle) => ctx.effect(() => ctx.connection.fetch.register({
    path: `/api/${BRIDGE_NAME}/${suffix}`, methods, requestBody: 'buffered',
    fetch: async request => {
      const admission = ctx.connection.admit(request);
      if (admission.rejection || admission.peer.principal.kind !== 'owner') return json({ message: 'Forbidden' }, admission.rejection ?? 403);
      try { return json(await handle(request)); }
      catch (error) { return json(failureOf(error), 400); }
    },
  }), `${BRIDGE_NAME}: ${suffix} route`);
  let cachedVersion, cachedQuota;
  function panelModels() {
    const families = adapter.modelCache;
    if (!families) return undefined;
    const visible = new Set(visibleModels(families, adapter.settings.hiddenModels).map(model => model.id));
    return { updatedAt: adapter.modelUpdatedAt, value: families.map(({ id, name, levels }) => ({ id, name, levels, visible: visible.has(id) })) };
  }
  mount('status', ['GET'], () => ({
    settings: adapter.settings, process: adapter.processState, resolvedExecutable: adapter.binary(),
    version: cachedVersion ?? null, quota: cachedQuota ?? null, models: panelModels() ?? null,
  }));
  mount('version', ['GET'], async () => {
    const executable = adapter.binary();
    const item = { value: await adapter.version(), updatedAt: Date.now() };
    if (executable === adapter.binary()) cachedVersion = item;
    return item;
  });
  mount('quota', ['GET'], async () => {
    const executable = adapter.binary();
    const item = { value: await adapter.quota(), updatedAt: Date.now() };
    if (executable === adapter.binary()) cachedQuota = item;
    return item;
  });
  mount('models', ['GET'], async () => {
    await adapter.getModelFamilies(true);
    const models = panelModels();
    if (!models) throw new Error('agy 模型目录已切换，请刷新。');
    return models;
  });
  mount('settings', ['POST'], async request => {
    const input = await request.json();
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
  mount('mode', ['GET', 'POST'], async request => {
    const controller = ctx.get('sessionController');
    if (request.method === 'GET') {
      const sessionId = new URL(request.url).searchParams.get('session');
      const agent = sessionId && ctx.agents.get(sessionId);
      if (agent || !sessionId || !controller) return adapter.modeInfo(agent || undefined);
      const state = await controller.projections({ sessionId }, request.signal);
      const selection = state?.values?.modelSelection;
      const current = selection?.next ?? selection?.lastUsed ?? ctx.get('agentDefaultModel')?.currentSelection();
      return adapter.modeInfo(undefined, current?.provider === 'agy', sessionId);
    }
    const { sessionId, mode } = await request.json();
    if (typeof sessionId !== 'string' || !sessionId || !MODES.includes(mode)) throw new Error('请指定当前会话和有效的 agy 模式。');
    let agent = ctx.agents.get(sessionId);
    if (!agent && controller) {
      const state = await controller.projections({ sessionId }, request.signal);
      const selection = state?.values?.modelSelection;
      const current = selection?.next ?? selection?.lastUsed ?? ctx.get('agentDefaultModel')?.currentSelection();
      if (current?.provider === 'agy') {
        const resolved = await controller.resolveAgent(sessionId);
        if (resolved.error) throw resolved.error;
        agent = resolved.agent;
      }
    }
    if (!usesAgy(agent)) throw new Error(wrongProvider);
    return adapter.setMode(agent, mode, request.signal);
  });
}
