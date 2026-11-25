import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BRIDGE_NAME, dataDirectory } from '../storage.js';

async function temporaryHome(t) {
  const home = await mkdtemp(path.join(path.resolve(tmpdir()), `${BRIDGE_NAME}-test-`));
  // Only remove the exact, absolute directory created for this test.
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

const read = (folder, name) => readFile(path.join(folder, name), 'utf8');
const write = (folder, name, text) => writeFile(path.join(folder, name), text);

test('first activation copies settings and mappings without changing old data', async t => {
  const home = await temporaryHome(t);
  const old = path.join(home, 'dsh-agy');
  await mkdir(old);
  const settings = '{"executable":"/path/to/agy","showToolActivity":false}';
  const sessions = '{"dsh-session":{"sessionId":"acp-session","ids":[],"mode":"plan"}}';
  await write(old, 'settings.json', settings);
  await write(old, 'sessions.json', sessions);
  await write(old, 'other.json', 'not owned by the migration');

  const expected = path.join(home, BRIDGE_NAME);
  assert.deepEqual(await Promise.all([dataDirectory(home), dataDirectory(home)]), [expected, expected]);
  assert.deepEqual((await readdir(expected)).sort(), ['sessions.json', 'settings.json']);
  for (const directory of [old, expected]) {
    assert.equal(await read(directory, 'settings.json'), settings);
    assert.equal(await read(directory, 'sessions.json'), sessions);
  }
  assert.equal(await read(old, 'other.json'), 'not owned by the migration');
  assert.deepEqual((await readdir(home)).sort(), ['dsh-agy', BRIDGE_NAME]);
});

test('already-created destination is never overwritten or filled from the old directory', async t => {
  const home = await temporaryHome(t);
  const old = path.join(home, 'dsh-agy');
  const current = path.join(home, BRIDGE_NAME);
  await mkdir(old);
  await mkdir(current);
  await write(old, 'settings.json', '{"executable":"/path/to/old/agy"}');
  await write(old, 'sessions.json', '{}');
  await write(current, 'settings.json', '{"executable":"/path/to/new/agy"}');

  assert.equal(await dataDirectory(home), current);
  assert.deepEqual(await readdir(current), ['settings.json']);
  assert.equal(await read(current, 'settings.json'), '{"executable":"/path/to/new/agy"}');
});

test('fresh install stays lazy, and a legacy directory with only one file is supported', async t => {
  const home = await temporaryHome(t);
  const current = path.join(home, BRIDGE_NAME);
  const previous = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = home;
    assert.equal(await dataDirectory(), current);
    assert.deepEqual(await readdir(home), []);
    const old = path.join(home, 'dsh-agy');
    await mkdir(old);
    await write(old, 'settings.json', '{}');
    assert.equal(await dataDirectory(), current);
    assert.deepEqual(await readdir(current), ['settings.json']);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }
});
