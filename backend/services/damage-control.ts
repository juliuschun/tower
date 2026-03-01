/**
 * Damage Control — role-based tool & Bash command restrictions.
 *
 * 4-tier role system:
 *   admin    → unrestricted
 *   operator → DENY_SYSTEM bash patterns
 *   member   → DENY_SYSTEM + DENY_SYSPACKAGE bash patterns
 *   viewer   → whitelist-only tools (read-only)
 */

import path from 'path';

export type TowerRole = 'admin' | 'operator' | 'member' | 'viewer';

export const VALID_ROLES = new Set<string>(['admin', 'operator', 'member', 'viewer']);

// ─── Bash deny patterns ─────────────────────────────────────────────────────

/** System-destructive patterns (operator + member) */
const DENY_SYSTEM: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /rm\s+(-[^\s]*)?r[^\s]*f[^\s]*\s+(\/(\s|$)|~|\$HOME)/,   label: 'recursive delete on root/home' },
  { pattern: /\bsudo\b/,                                               label: 'privilege escalation (sudo)' },
  { pattern: /\bcurl\b.*\|\s*(sh|bash|zsh)/,                           label: 'remote script execution (curl|sh)' },
  { pattern: /\bwget\b.*\|\s*(sh|bash|zsh)/,                           label: 'remote script execution (wget|sh)' },
  { pattern: /\bchmod\s+777\b/,                                        label: 'chmod 777' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/,                    label: 'system shutdown/reboot' },
  { pattern: /\bgit\s+push\s+(-[^\s]*f|--force)/,                     label: 'git force push' },
  { pattern: /\bnpm\s+publish\b/,                                      label: 'npm publish' },
  { pattern: /\bmkfs\b/,                                               label: 'filesystem format (mkfs)' },
  { pattern: /\bdd\s+if=/,                                             label: 'raw disk write (dd)' },
];

/** System package management patterns (member only) */
const DENY_SYSPACKAGE: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(apt|apt-get)\s+(install|remove|purge|autoremove)\b/,  label: 'apt package management' },
  { pattern: /\bsystemctl\s+(start|stop|restart|enable|disable)\b/,    label: 'systemctl service control' },
  { pattern: /\bservice\s+\S+\s+(start|stop|restart)\b/,              label: 'service control' },
];

// ─── Viewer whitelist ────────────────────────────────────────────────────────

const VIEWER_ALLOWED_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'AskUserQuestion',
]);

// ─── Factory ─────────────────────────────────────────────────────────────────

export type DamageCheckResult = { allowed: true } | { allowed: false; message: string };

export function buildDamageControl(
  role: TowerRole | string,
): (toolName: string, input: Record<string, unknown>) => DamageCheckResult {
  // Unknown roles (e.g. legacy 'user') → treat as member
  const effectiveRole: TowerRole = VALID_ROLES.has(role) ? (role as TowerRole) : 'member';

  return (toolName: string, input: Record<string, unknown>): DamageCheckResult => {
    // ── Viewer: whitelist-only ──
    if (effectiveRole === 'viewer') {
      if (!VIEWER_ALLOWED_TOOLS.has(toolName)) {
        return { allowed: false, message: `[Damage Control] Viewer role cannot use the ${toolName} tool.` };
      }
      return { allowed: true };
    }

    // ── Admin: unrestricted ──
    if (effectiveRole === 'admin') {
      return { allowed: true };
    }

    // ── Operator / Member: check Bash commands ──
    if (toolName === 'Bash') {
      const command = String(input.command || '');

      // DENY_SYSTEM (operator + member)
      for (const rule of DENY_SYSTEM) {
        if (rule.pattern.test(command)) {
          return { allowed: false, message: `[Damage Control] Blocked: ${rule.label}. The ${effectiveRole} role cannot run this command.` };
        }
      }

      // DENY_SYSPACKAGE (member only)
      if (effectiveRole === 'member') {
        for (const rule of DENY_SYSPACKAGE) {
          if (rule.pattern.test(command)) {
            return { allowed: false, message: `[Damage Control] Blocked: ${rule.label}. The member role cannot manage system packages.` };
          }
        }
      }
    }

    return { allowed: true };
  };
}

// ─── Path Enforcement ───────────────────────────────────────────────────────

/**
 * Build a path enforcement checker that restricts file tool access
 * to within the given allowedPath directory.
 */
export function buildPathEnforcement(allowedPath: string) {
  const root = path.resolve(allowedPath) + path.sep;
  return (toolName: string, input: Record<string, unknown>): DamageCheckResult => {
    const paths: string[] = [];
    // File tools: file_path, path, notebook_path params
    for (const key of ['file_path', 'path', 'notebook_path']) {
      if (typeof input[key] === 'string') paths.push(input[key] as string);
    }
    // Bash: extract absolute paths from command (skip safe system paths)
    if (toolName === 'Bash' && typeof input.command === 'string') {
      const absPaths = (input.command as string).match(
        /(?:^|\s)(\/(?!dev\/null|dev\/stderr|dev\/stdout|tmp\/|usr\/bin\/|bin\/)[^\s;&|>"']+)/g
      );
      if (absPaths) paths.push(...absPaths.map(p => p.trim()));
    }
    for (const p of paths) {
      const resolved = path.resolve(p);
      // Allow exact match (the root dir itself) or anything inside it
      if (resolved + path.sep !== root && !resolved.startsWith(root)) {
        console.warn(`[Path Enforcement] Denied: "${p}" outside root "${root.slice(0, -1)}" (tool: ${toolName})`);
        return { allowed: false, message: `[Path Restriction] Access denied: "${p}" is outside your allowed workspace.` };
      }
    }
    return { allowed: true };
  };
}
