import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalDecision, createPermissionBridge } from '../permission.js';

const allow = { optionId: 'allow', name: 'Allow', kind: 'allow_once' };
const deny = { optionId: 'deny', name: 'Deny', kind: 'reject_once' };
const always = { optionId: 'always', name: 'Always allow this', kind: 'allow_always' };
const never = { optionId: 'never', name: 'Always deny this', kind: 'reject_always' };
const session = { header: {} };
const agent = { session };
const normal = { title: 'Read file', detail: 'notes.txt', options: [allow, deny] };
const signal = () => new AbortController().signal;
const selected = optionId => ({ outcome: 'selected', optionId });

function fixture({ preset = 'workspace-write', policy = 'ask', native = () => 'rejected', questions, timeout } = {}) {
  let listener;
  const requests = [];
  const approval = { request(req) { requests.push(req); return listener(req, () => native(req)); } };
  const services = { approval, userQuestions: questions && { ask: questions }, permissionPresets: {
    current: () => preset, resolve: () => ({ approval: policy }),
  } };
  const bridge = createPermissionBridge({ on: (_event, handler) => { listener = handler; }, get: key => services[key] }, timeout);
  return { bridge, requests, listener };
}

test('explicit Full access selects allow_once and announces it, never allow_always', async () => {
  const { bridge, requests } = fixture({ preset: 'danger-full-access', policy: 'never' });
  const result = await bridge(agent, { ...normal, options: [always, deny, allow] }, signal());
  assert.deepEqual(result.response, selected('allow'));
  assert.match(result.notice, /全权限预设：已自动允许 Read file/);
  assert.equal(requests.length, 0);
  assert.deepEqual((await bridge(agent, { ...normal, options: [always, deny] }, signal())).response, selected('deny'));
});

test('other never policy is not Full access; ordinary Ask and Auto use native approval', async () => {
  for (const preset of ['workspace-write', 'auto', 'custom']) {
    const { bridge, requests } = fixture({ preset, native: () => preset === 'custom' ? 'rejected' : 'allowed-once' });
    assert.deepEqual((await bridge(agent, normal, signal())).response, selected(preset === 'custom' ? 'deny' : 'allow'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].agent, agent);
    assert.equal(requests[0].callId, undefined);
    assert.match(requests[0].reason, /Read file.*notes\.txt/);
  }
});

test('rejection, cancellation, unavailable, timeout and missing options fail closed', async () => {
  for (const outcome of ['rejected', 'cancelled', 'unavailable', 'anything-else']) {
    assert.deepEqual(approvalDecision(outcome, [allow, deny]), selected('deny'));
  }
  assert.deepEqual(approvalDecision('allowed-once', [always, deny]), selected('deny'));
  assert.deepEqual(approvalDecision('rejected', [allow, never]), { outcome: 'cancelled' });
  const { bridge } = fixture({ timeout: 1, native: async () => { await new Promise(resolve => setTimeout(resolve, 10)); return 'allowed-once'; } });
  assert.deepEqual((await bridge(agent, normal, signal())).response, selected('deny'));
  assert.deepEqual((await bridge(agent, normal, AbortSignal.abort())).response, { outcome: 'cancelled' });
  assert.deepEqual((await bridge(undefined, normal, signal())).response, selected('deny'));
  assert.deepEqual((await bridge({ session: { header: { origin: 'subagent' } } }, normal, signal())).response, selected('deny'));
});

test('extended waterfall preserves exact choices; free text and unknown labels never approve', async () => {
  for (const [option, custom, expected] of [[always.name, '', 'always'], [never.name, '', 'never'], [allow.name, 'Authorize me', 'deny'], ['No such option', '', 'deny']]) {
    const { bridge, listener, requests } = fixture({
      native: () => { throw new Error('Extended ACP options should not use the two-button card'); },
      questions: ({ questions }) => {
        assert.deepEqual(questions[0].options.map(row => row.label), [allow.name, deny.name, always.name, never.name]);
        return { answers: [{ id: questions[0].id, selected: [option], custom }] };
      },
    });
    // The extra answerer does not claim unrelated native tool approvals.
    assert.equal(await listener({ agent }, () => 'allowed-once'), 'allowed-once');
    const { response } = await bridge(agent, { ...normal, options: [allow, deny, always, never] }, signal());
    assert.deepEqual(response, selected(expected));
    assert.equal(requests.length, 1);
  }
});
