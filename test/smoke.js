// Opt-in smoke test: uses the real signed-in CLI and consumes a small model request.
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rmdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpClient, prompt, runAgy, textBlock } from '../acp.js';
import { parseQuota } from '../model.js';

const file = process.argv[2] || join(homedir(), '.local/bin/agy');
const cwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-agy-bridge-smoke-')));
const short = AbortSignal.timeout(30_000);
const modelId = 'gemini-3.8-flash-low';
const acp = new AcpClient(file, { cwd });
let second;
let sessionId;
try {
  const hello = await acp.initialize();
  assert.equal(hello.protocolVersion, 1);
  assert.equal(hello.agentCapabilities.promptCapabilities.image, true);
  const state = await acp.request('session/new', { cwd, mcpServers: [] });
  ({ sessionId } = state);
  console.log('Fresh temporary workspace accepted; initial mode:', state.modes?.currentModeId);
  await acp.request('session/set_mode', { sessionId, modeId: 'default' });
  await acp.request('session/set_model', { sessionId, modelId });
  let text = '';
  const updates = new Set();
  const result = await prompt(acp, sessionId, [textBlock('Reply only OK; no tools.')], {
    signal: short,
    update(u) { updates.add(u.sessionUpdate); if (u.sessionUpdate === 'agent_message_chunk') text += u.content.text; },
  });
  console.log('Stream:', text.trim(), 'updates:', [...updates], 'usage:', result.usage);
  assert.equal(result.stopReason, 'end_turn');
  assert.match(text, /OK/i);
  assert.equal(typeof result.usage?.inputTokens, 'number');
  const controller = new AbortController();
  const attempt = prompt(acp, sessionId, [textBlock('Write a short poem. No tools.')], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100).unref();
  const aborted = await attempt;
  console.log('Cancel:', aborted.stopReason);
  assert.equal(aborted.stopReason, 'cancelled');

  if (process.env.AGY_TEST_PERMISSION === '1') {
    let asked = false;
    const result = await prompt(acp, sessionId, [textBlock('Run exactly `printf ok` with the shell tool; do not write files.')], {
      signal: AbortSignal.timeout(20_000),
      update(u) { if (u.sessionUpdate.startsWith('tool_call')) console.log('Tool:', u.sessionUpdate, u.title, u.status); },
      permission({ options }) {
        asked = true;
        console.log('Permission options:', options);
        const reject = options.find(option => option.kind === 'reject_once');
        return reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' };
      },
    });
    console.log('Permission request observed:', asked, '| stop:', result.stopReason);
    assert.ok(asked);
  }
  await acp.request('session/close', { sessionId });
  await acp.dispose();
  second = new AcpClient(file, { cwd });
  await second.initialize();
  const resumed = await second.request('session/resume', { sessionId, cwd, mcpServers: [] });
  console.log('Resume after restart:', Boolean(resumed));
  await second.request('session/close', { sessionId });
  const replay = [];
  const off = second.subscribe(sessionId, u => { if (/^(user|agent)_message_chunk$/.test(u.sessionUpdate)) replay.push(u); });
  await second.request('session/load', { sessionId, cwd, mcpServers: [] });
  off();
  console.log('Load replay:', replay.map(u => u.sessionUpdate));
  assert.ok(replay.some(u => u.sessionUpdate === 'user_message_chunk'));
  assert.ok(replay.some(u => u.sessionUpdate === 'agent_message_chunk'));
  const listed = await second.request('session/list', {});
  assert.ok(listed.sessions.some(s => s.sessionId === sessionId));
  await second.request('session/close', { sessionId });
  const usage = parseQuota(await runAgy(file, ['-p', '/usage'], { cwd }));
  assert.equal(usage.length, 4);
  console.log('Quota: four valid TSV entries');
} finally {
  await Promise.all([acp.dispose(), second?.dispose()]);
  await rmdir(cwd);
}
