import { homedir } from 'node:os';
import { join } from 'node:path';

const appDir = join(homedir(), '.lark-codex');

export const paths = {
  appDir,
  cacheDir: appDir,
  configFile: join(appDir, 'config.json'),
  sessionsFile: join(appDir, 'sessions.json'),
  workspacesFile: join(appDir, 'workspaces.json'),
  processesFile: join(appDir, 'processes.json'),
  secretsFile: join(appDir, 'secrets.enc'),
  keystoreSaltFile: join(appDir, '.keystore.salt'),
  /**
   * Thin shell wrapper that exec-provider consumers can invoke to resolve
   * secrets from the bridge's encrypted store. Wrapper internals do the
   * `node ... secrets get` invocation.
   */
  secretsGetterScript: join(appDir, 'secrets-getter'),
  mediaDir: join(appDir, 'media'),
};

/**
 * Pre-0.1.11 paths (XDG-style). Kept here only so the `migrate` command
 * can detect and move data out of the old location. Don't reference these
 * anywhere in the runtime.
 */
export const legacyPaths = {
  appDir: join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'lark-codex-bridge',
  ),
  cacheDir: join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
    'lark-codex-bridge',
  ),
};
