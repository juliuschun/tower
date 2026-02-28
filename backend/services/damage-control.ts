/**
 * Damage Control — role-based tool & Bash command restrictions.
 *
 * 4-tier role system:
 *   admin    → unrestricted
 *   operator → DENY_SYSTEM bash patterns
 *   member   → DENY_SYSTEM + DENY_SYSPACKAGE bash patterns
 *   viewer   → whitelist-only tools (read-only)
 */

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

type DamageCheckResult = { allowed: true } | { allowed: false; message: string };

export function buildDamageControl(
  role: TowerRole | string,
): (toolName: string, input: Record<string, unknown>) => DamageCheckResult {
  // Unknown roles (e.g. legacy 'user') → treat as member
  const effectiveRole: TowerRole = VALID_ROLES.has(role) ? (role as TowerRole) : 'member';

  return (toolName: string, input: Record<string, unknown>): DamageCheckResult => {
    // ── Viewer: whitelist-only ──
    if (effectiveRole === 'viewer') {
      if (!VIEWER_ALLOWED_TOOLS.has(toolName)) {
        return { allowed: false, message: `[Damage Control] viewer 역할은 ${toolName} 도구를 사용할 수 없습니다.` };
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
          return { allowed: false, message: `[Damage Control] 차단됨: ${rule.label}. ${effectiveRole} 역할에서는 이 명령을 실행할 수 없습니다.` };
        }
      }

      // DENY_SYSPACKAGE (member only)
      if (effectiveRole === 'member') {
        for (const rule of DENY_SYSPACKAGE) {
          if (rule.pattern.test(command)) {
            return { allowed: false, message: `[Damage Control] 차단됨: ${rule.label}. member 역할에서는 시스템 패키지 관리를 할 수 없습니다.` };
          }
        }
      }
    }

    return { allowed: true };
  };
}
