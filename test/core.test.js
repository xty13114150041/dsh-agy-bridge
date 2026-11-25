import assert from 'node:assert/strict';
import test from 'node:test';
import { frameReader } from '../acp.js';
import { AgyAdapter, normalizeSettings } from '../adapter.js';
import { createPermissionBridge } from '../permission.js';
import { failureOf, modelRoute, parseModels, parseQuota, planPrompt, renderHistory, tokenUsage, validateHiddenModels } from '../model.js';

const message = (id, role, text, kind = role) => ({ id, role, source: { kind }, content: [{ type: 'text', text }] });
const user = (id, text, kind) => message(id, 'user', text, kind);
const assistant = (id, text) => message(id, 'assistant', text);
const sys = message('sys', 'system', 'DSH_SYSTEM');
const builtin = user('rt', 'DSH_RUNTIME', 'runtime-context');

const quotaTsv = [
  'Gemini Models\tFive Hour Limit Remaining\t83%\t2026-11-25T10:54:59Z',
  'Gemini Models\tWeekly Limit Remaining\t71%\t2026-11-30T20:00:00Z',
  'Claude and GPT models\tFive Hour Limit Remaining\t0%\t2026-11-25T00:00:00Z',
  'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-11-29T21:00:00Z',
].join('\r\n');

test('ACP frames can span bytes, UTF-8 characters and multiple messages', () => {
  const messages = [];
  const read = frameReader(frame => messages.push(frame));
  const bytes = Buffer.from('\r\n{"jsonrpc":"2.0","id":1,"result":"你好"}\r\n{"jsonrpc":"2.0","id":2,"result":{}}\n');
  for (const byte of bytes) read(Buffer.of(byte));
  assert.deepEqual(messages.map(m => m.result), ['你好', {}]);
  assert.throws(() => read(Buffer.from('not JSON\n')), SyntaxError);
});

test('CLI TSV parses four expiry times, rejects schema changes', () => {
  assert.deepEqual(parseQuota(quotaTsv)[0], { group: 'gemini', period: 'fiveHours', remaining: 83, resetAt: '2026-11-25T10:54:59Z' });
  assert.equal(parseQuota(quotaTsv).length, 4);
  assert.throws(() => parseQuota(quotaTsv.replace('100%', '101%')), /TSV/);
  assert.throws(() => parseQuota(quotaTsv + '\n' + quotaTsv), /Duplicate/);
});

const models = parseModels([
  'gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)', 'gemini-4-neon-medium\tGemini 4 Neon (Medium)',
  'gemini-4-neon-high\tGemini 4 Neon (High)', 'gemini-4-neon-low\tGemini 4 Neon (Low)',
  'gemini-pro-orchestrator-neon\tOrchestrator (Neon)', 'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  'other-low\tOther (Low)', 'other-medium\tOther (Medium)', 'other-xhigh\tOther (XHigh)',
].join('\r\n'));

test('catalog groups variants, preserves meaningful parentheses, and declares only selectable efforts', () => {
  assert.deepEqual(models.map(m => [m.id, m.name]), [
    ['gemini-4-neon', 'Gemini 4 Neon'], ['gemini-pro-orchestrator-neon', 'Orchestrator (Neon)'],
    ['gpt-oss-120b', 'GPT-OSS 120B'], ['other', 'Other'],
  ]);
  const neon = modelRoute(models, 'gemini-4-neon');
  assert.deepEqual(neon.info('agy').reasoning, {
    efforts: ['low', 'medium', 'high', 'xhigh'].map((id, i) => ({ id, name: ['Low', 'Medium', 'High', 'XHigh'][i] })),
    defaultEffort: 'high',
  });
  assert.equal(neon.slug(), 'gemini-4-neon-high');
  assert.equal(neon.slug('xhigh'), 'gemini-4-neon-xhigh');
  assert.equal(modelRoute(models, 'other').slug(), 'other-medium');
  assert.throws(() => modelRoute(models, 'other').slug('high'), { code: 'UNSUPPORTED_REASONING_EFFORT' });
  assert.throws(() => modelRoute(models, 'missing'), { code: 'UNKNOWN_MODEL' });
  const fixed = modelRoute(models, 'gpt-oss-120b');
  assert.equal(fixed.info('agy').reasoning, undefined);
  assert.equal(fixed.slug(), 'gpt-oss-120b-medium');
  assert.equal(modelRoute(models, 'gemini-pro-orchestrator-neon').slug(), 'gemini-pro-orchestrator-neon');
});

test('old slug keeps its exact stored ID and default; hidden routes still resolve', async () => {
  const legacy = modelRoute(models, 'gemini-4-neon-low');
  assert.equal(legacy.info('agy').id, 'gemini-4-neon-low');
  assert.equal(legacy.info('agy').reasoning.defaultEffort, 'low');
  assert.equal(legacy.slug(), 'gemini-4-neon-low');
  const adapter = new AgyAdapter({ directory: '.', settings: { hiddenModels: ['gemini-4-neon'] }, records: {} });
  adapter.modelCache = models;
  assert.ok(!(await adapter.listModels('agy')).some(model => model.id === 'gemini-4-neon'));
  assert.equal((await adapter.resolveModel('agy', 'gemini-4-neon')).reasoning.defaultEffort, 'high');
  assert.equal((await adapter.resolveModel('agy', 'gemini-4-neon-low')).reasoning.defaultEffort, 'low');
});

test('settings migrate the old format and reject hiding the last model', () => {
  const executable = '/path/to/agy';
  assert.deepEqual(normalizeSettings({ executable }), { executable, showToolActivity: true, hiddenModels: [] });
  assert.deepEqual(normalizeSettings({ showToolActivity: false, hiddenModels: ['other', 'other'] }), { executable: '', showToolActivity: false, hiddenModels: ['other'] });
  assert.throws(() => normalizeSettings({ showToolActivity: 'false' }), /布尔/);
  assert.doesNotThrow(() => validateHiddenModels(models, ['other']));
  assert.throws(() => validateHiddenModels(models, models.map(model => model.id)), /至少/);
  assert.throws(() => validateHiddenModels(models, ['removed-family']), /刷新/);
});

for (const [showToolActivity, fullAccess] of [[true, false], [false, false], [false, true]]) test(`ACP dispatch preserves permission notices (tool activity=${showToolActivity}, full access=${fullAccess})`, async () => {
  const ask = createPermissionBridge({ on() {}, get: key => key === 'permissionPresets' && fullAccess ? {
    current: () => 'danger-full-access', resolve: () => ({ approval: 'never' }),
  } : undefined });
  const adapter = new AgyAdapter({ directory: '.', settings: { showToolActivity }, records: {}, ask,
    getAgent: () => ({ session: { header: {} } }), cwdOf: () => '.',
  });
  adapter.save = async () => {}; // In-memory test; no session JSON writes.
  adapter.modelCache = models;
  const calls = [];
  let update;
  const client = {
    onPermission: new Map(), subscribe(_id, listener) { update = listener; return () => {}; },
    async request(method, params) {
      calls.push([method, params]);
      if (method === 'session/prompt') {
        const toolCall = { sessionUpdate: 'tool_call', toolCallId: 'tool', title: 'Test tool', status: 'pending' };
        update(toolCall);
        const selection = await this.onPermission.get(params.sessionId)({ toolCall, options: [{ kind: 'reject_once', optionId: 'deny' }, { kind: 'allow_once', optionId: 'allow' }] });
        assert.equal(selection.optionId, fullAccess ? 'allow' : 'deny');
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } });
        return { stopReason: 'end_turn' };
      }
      return {};
    },
  };
  adapter.acquire = async () => client;
  adapter.open = async () => ({ id: 'temp' });
  adapter.close = async () => {};
  const prepared = await adapter.prepareCall('agy', 'gemini-4-neon');
  const chunks = await Array.fromAsync(prepared.stream({
    model: 'gemini-4-neon', reasoningEffort: 'medium', sessionId: 'test', messages: [user('u', 'short test')],
  }));
  assert.deepEqual(calls[0], ['session/set_model', { sessionId: 'temp', modelId: 'gemini-4-neon-medium' }]);
  assert.equal(chunks.some(chunk => chunk.text?.includes('Test tool → pending')), showToolActivity);
  assert.ok(chunks.some(chunk => chunk.text?.includes(fullAccess ? '全权限预设：已自动允许 Test tool' : 'agy 请求权限')));
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});

test('stable prefix sends only new user content, preserving hook context', () => {
  const first = user('u1', 'first');
  const old = { ...planPrompt([sys, first, builtin]).cursor, reply: 'answer' };
  const next = planPrompt([sys, first, assistant('a1', 'answer'), builtin, user('u2', 'second'), user('h2', 'hook reminder', 'hooks-codex')], old);
  assert.equal(next.reuse, true);
  assert.equal(next.text, 'second\n\nhook reminder');
});

test('branch or compaction replays visible history without DSH system or reasoning', () => {
  const first = user('u1', 'original');
  const old = { ...planPrompt([first]).cursor, reply: 'old reply' };
  const history = [sys, user('c1', 'summary', 'compaction'), assistant('a1', 'new reply'), user('u2', 'next')];
  const next = planPrompt(history, old);
  assert.equal(next.reuse, false);
  assert.match(next.text, /User:\nsummary\n\nAssistant:\nnew reply/);
  assert.match(next.text, /\n\nnext$/);
  assert.doesNotMatch(next.text, /DSH_SYSTEM|old reply/);
  assert.equal(renderHistory([assistant('test', 'final answer')]), 'Assistant:\nfinal answer');
});

test('failed prompt replaces the upstream conversation but a successful duplicate sends nothing', () => {
  const first = user('u1', 'do it');
  const cursor = planPrompt([first]).cursor;
  assert.equal(planPrompt([first], { ...cursor, dirty: true }).reuse, false);
  assert.equal(planPrompt([first], { ...cursor, dirty: true }).text, 'do it');
  assert.deepEqual(planPrompt([first], { ...cursor, reply: 'done' }), { reuse: true, text: '', cursor });
});

test('native slash command remains exact; a dirty history cannot silently turn it into an ordinary prompt', () => {
  const first = user('u1', 'hello');
  const old = { ...planPrompt([first]).cursor, reply: 'ok' };
  const next = [first, assistant('a1', 'ok'), user('u2', '/agy goal test'), user('h2', 'hook', 'hooks-codex')];
  assert.equal(planPrompt(next, old).text, '/goal test');
  assert.match(planPrompt(next, { ...old, dirty: true }).error, /重建会话/);
});

test('auxiliary calls carry caller instructions as text, not DSH system-role content', () => {
  const result = planPrompt([sys, user('u1', 'please rewrite')], undefined, { purpose: 'persona-voice', system: 'persona rules' });
  assert.equal(result.reuse, false);
  assert.match(result.text, /^\[任务指令\]\npersona rules\n\[\/任务指令\]/);
  assert.doesNotMatch(result.text, /DSH_SYSTEM/);
});

test('usage keeps cache tokens disjoint; supported retry codes are retained', () => {
  assert.deepEqual(tokenUsage({ inputTokens: 100, cachedReadTokens: 40, cachedWriteTokens: 10, outputTokens: 20, totalTokens: 120, thoughtTokens: 3 }),
    { inputTokens: 50, cacheReadTokens: 40, cacheWriteTokens: 10, outputTokens: 20, totalTokens: 120, reasoningTokens: 3 });
  assert.equal(failureOf(new Error('Authentication required')).code, 'AUTH');
  assert.equal(failureOf(new Error('Quota exceeded')).code, 'QUOTA');
  assert.equal(failureOf(new Error('HTTP 429')).code, 'RATE_LIMIT');
  assert.equal(failureOf(Object.assign(new Error('ACP exited'), { code: 'TRANSPORT' })).code, 'TRANSPORT');
});
