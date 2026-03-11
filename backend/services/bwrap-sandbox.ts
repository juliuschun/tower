/**
 * bwrap (bubblewrap) Sandbox — lightweight process isolation for Claude CLI sessions.
 *
 * Wraps Claude CLI execution in a Linux namespace sandbox that:
 *   - Isolates filesystem: only allowed_path is writable, host /home is invisible
 *   - Isolates PIDs: sandbox processes can't see host processes
 *   - Passes through network (Claude API needs it)
 *   - Dies with parent process (no zombie orphans)
 *
 * Requires: apt install bubblewrap
 * Linux only. Disabled on other platforms via config.sandboxEnabled.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { config } from '../config.js';

type TowerRole = 'admin' | 'operator' | 'member' | 'viewer';

interface BwrapProfile {
  allowProc: boolean;       // mount /proc (process list visibility)
  networkEnabled: boolean;  // --unshare-net if false
}

const BWRAP_PROFILES: Record<TowerRole, BwrapProfile> = {
  admin:    { allowProc: true,  networkEnabled: true },
  operator: { allowProc: true,  networkEnabled: true },
  member:   { allowProc: false, networkEnabled: true },   // can't see host processes
  viewer:   { allowProc: false, networkEnabled: false },   // no network (Bash blocked by Damage Control anyway)
};

/**
 * Build bwrap argument array for SDK's executableArgs.
 *
 * The resulting command is:
 *   bwrap [these args] -- node
 *   (SDK appends its own args after node)
 */
export function buildBwrapArgs(
  allowedPath: string,
  role: TowerRole,
): string[] {
  const profile = BWRAP_PROFILES[role] || BWRAP_PROFILES.member;
  const args: string[] = [];

  // ── System binaries (read-only) ──
  for (const dir of ['/usr', '/bin', '/lib', '/lib64']) {
    if (fs.existsSync(dir)) {
      args.push('--ro-bind', dir, dir);
    }
  }

  // ── /sbin for system tools some scripts expect ──
  if (fs.existsSync('/sbin')) {
    args.push('--ro-bind', '/sbin', '/sbin');
  }

  // ── /etc: only what's needed ──
  for (const f of [
    '/etc/resolv.conf',    // DNS
    '/etc/ssl',            // SSL certificates
    '/etc/passwd',         // user info (some tools need it)
    '/etc/group',          // group info
    '/etc/hostname',       // hostname
    '/etc/localtime',      // timezone
    '/etc/alternatives',   // Debian alternatives symlinks
  ]) {
    args.push('--ro-bind-try', f, f);
  }

  // ── Workspace (read/write) — this is the ONLY writable host path ──
  const resolvedPath = path.resolve(allowedPath);
  args.push('--bind', resolvedPath, '/workspace');

  // ── Claude CLI binary (read-only) ──
  const claudeReal = fs.realpathSync(config.claudeExecutable);
  const claudeDir = path.dirname(claudeReal);
  args.push('--ro-bind', claudeDir, '/claude-bin');

  // ── Claude config dir (~/.claude) for settings, skills, CLAUDE.md ──
  const claudeConfigDir = path.join(os.homedir(), '.claude');
  if (fs.existsSync(claudeConfigDir)) {
    args.push('--ro-bind', claudeConfigDir, path.join('/home/sandbox', '.claude'));
  }

  // ── Session data dir for resume (.jsonl files) — needs write ──
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (fs.existsSync(claudeProjectsDir)) {
    args.push('--bind', claudeProjectsDir, path.join('/home/sandbox', '.claude', 'projects'));
  }

  // ── Isolated temp space ──
  args.push('--tmpfs', '/tmp');
  args.push('--tmpfs', '/run');
  args.push('--dev', '/dev');

  // ── /proc ──
  if (profile.allowProc) {
    args.push('--proc', '/proc');
  }

  // ── Namespace isolation ──
  args.push('--unshare-pid');
  args.push('--unshare-uts');
  args.push('--unshare-ipc');

  if (!profile.networkEnabled) {
    args.push('--unshare-net');
  }

  // ── Safety ──
  args.push('--die-with-parent');
  args.push('--new-session');

  // ── Set HOME so Claude CLI finds ~/.claude ──
  args.push('--setenv', 'HOME', '/home/sandbox');

  // ── Separator + executable ──
  args.push('--');
  args.push('node');

  return args;
}

/**
 * Check if bwrap is available on this system.
 */
export function isBwrapAvailable(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('bwrap --version', { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether sandbox should be used for this session.
 */
export function shouldUseSandbox(): boolean {
  return config.sandboxEnabled && process.platform === 'linux';
}
