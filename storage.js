import { copyFile, lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const BRIDGE_NAME = 'dsh-agy-bridge';

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function dataDirectory(home = process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')) {
  const directory = path.resolve(home, BRIDGE_NAME);
  const legacy = path.resolve(home, 'dsh-agy');
  if (await exists(directory) || !await exists(legacy)) return directory;

  // Stage beside the destination so activation never sees a half-copied set.
  const staging = await mkdtemp(path.resolve(home, `.${BRIDGE_NAME}-`));
  try {
    for (const name of ['settings.json', 'sessions.json']) {
      try { await copyFile(path.join(legacy, name), path.join(staging, name)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!await exists(directory)) {
      try { await rename(staging, directory); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    }
  } finally {
    // Only the exact directory returned by this call's mkdtemp is ours to remove.
    await rm(staging, { recursive: true, force: true });
  }
  return directory;
}
