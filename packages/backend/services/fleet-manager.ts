/**
 * Fleet Manager — Managed service customer VM operations
 *
 * Reads customer registry from library.yaml, SSHs into VMs to collect status.
 * Admin-only functionality for Moat AI internal use.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────

export interface CustomerInfo {
  name: string;
  profile: string;
  ssh: string;
  domain: string;
  team_name?: string;
  skills_dir?: string;
}

export interface VMStatus {
  customer: string;
  domain: string;
  team_name: string;
  profile: string;
  ssh: string;
  reachable: boolean;
  pm2?: { name: string; status: string; cpu: string; memory: string; uptime: string };
  disk?: { total: string; used: string; avail: string; pct: string };
  memory?: { total: string; used: string; free: string };
  load?: string;
  git_rev?: string;
  git_date?: string;
  port_listening?: boolean;
  ssl_expires?: string;
  skill_count?: number;
  project_count?: number;
  workspace_ok?: boolean;
  error?: string;
}

export interface WorkspaceCheck {
  customer: string;
  root: Record<string, boolean | string>;
  projects: Array<{
    name: string;
    agents_md: boolean | string; // true, false, or 'template-only'
    claude_symlink: boolean;
    project_dir: boolean;
    progress_md: boolean;
    decisions_dir: boolean;
  }>;
  fixes_applied?: string[];
}

// ── Library YAML reader ──────────────────────────────────────────

const LIBRARY_YAML = path.join(os.homedir(), '.claude/skills/library/library.yaml');

export async function getCustomers(): Promise<CustomerInfo[]> {
  // Use python3 to parse YAML (already available, used by deploy-profile.sh)
  const { stdout } = await execFileAsync('python3', ['-c', `
import yaml, json, sys
with open("${LIBRARY_YAML}") as f:
    data = yaml.safe_load(f)
customers = data.get("customers", {})
result = []
for name, info in customers.items():
    result.append({
        "name": name,
        "profile": info.get("profile", ""),
        "ssh": info.get("ssh", ""),
        "domain": info.get("domain", ""),
        "team_name": info.get("team_name", ""),
        "skills_dir": info.get("skills_dir", "~/.claude/skills/"),
    })
print(json.dumps(result))
  `]);
  return JSON.parse(stdout.trim());
}

export async function getCustomer(name: string): Promise<CustomerInfo | null> {
  const customers = await getCustomers();
  return customers.find(c => c.name === name) || null;
}

// ── SSH helper ───────────────────────────────────────────────────

async function sshExec(target: string, command: string, timeoutMs = 15000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('ssh', [
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',
      target,
      command,
    ], { timeout: timeoutMs });
    return stdout;
  } catch (err: any) {
    if (err.killed) throw new Error('SSH timeout');
    throw new Error(err.stderr || err.message);
  }
}

// ── Fleet Status ─────────────────────────────────────────────────

export async function getFleetStatus(): Promise<VMStatus[]> {
  const customers = await getCustomers();
  const results = await Promise.allSettled(
    customers.map(c => getVMStatus(c))
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      customer: customers[i].name,
      domain: customers[i].domain,
      team_name: customers[i].team_name || '',
      profile: customers[i].profile,
      ssh: customers[i].ssh,
      reachable: false,
      error: (r.reason as Error).message,
    };
  });
}

export async function getVMStatus(info: CustomerInfo): Promise<VMStatus> {
  const result: VMStatus = {
    customer: info.name,
    domain: info.domain,
    team_name: info.team_name || '',
    profile: info.profile,
    ssh: info.ssh,
    reachable: false,
  };

  try {
    const raw = await sshExec(info.ssh, `
echo "===PM2==="
pm2 list --no-color 2>/dev/null | grep tower || echo "NO_PM2"
echo "===DISK==="
df -h / | tail -1 | awk '{print $2"|"$3"|"$4"|"$5}'
echo "===MEM==="
free -m | grep Mem | awk '{print $2"|"$3"|"$4}'
echo "===LOAD==="
cat /proc/loadavg | awk '{print $1}'
echo "===GIT==="
cd ~/tower && git log -1 --format="%h|%ci" 2>/dev/null || echo "NO_GIT"
echo "===PORT==="
ss -tlnp 2>/dev/null | grep 32364 | wc -l
echo "===SSL==="
echo | openssl s_client -connect ${info.domain}:443 -servername ${info.domain} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "SSL_ERR"
echo "===SKILLS==="
ls ~/.claude/skills/ 2>/dev/null | wc -l
echo "===PROJECTS==="
ls ~/workspace/projects/ 2>/dev/null | wc -l
echo "===WORKSPACE==="
test -f ~/workspace/CLAUDE.md && test -f ~/workspace/principles.md && test -d ~/workspace/guide && echo "OK" || echo "INCOMPLETE"
    `);

    result.reachable = true;

    // Parse sections
    const sections = new Map<string, string>();
    let currentKey = '';
    for (const line of raw.split('\n')) {
      const m = line.match(/^===(\w+)===$/);
      if (m) { currentKey = m[1]; sections.set(currentKey, ''); continue; }
      if (currentKey) {
        sections.set(currentKey, (sections.get(currentKey) || '') + line.trim());
      }
    }

    // PM2
    const pm2Line = sections.get('PM2') || '';
    if (pm2Line && !pm2Line.includes('NO_PM2')) {
      const cols = pm2Line.split('│').map(s => s.trim()).filter(Boolean);
      if (cols.length >= 10) {
        result.pm2 = {
          name: cols[1] || 'tower-prod',
          status: cols[9] || 'unknown',
          cpu: cols[10] || '?',
          memory: cols[11] || '?',
          uptime: cols[7] || '?',
        };
      }
    }

    // Disk
    const diskParts = (sections.get('DISK') || '').split('|');
    if (diskParts.length >= 4) {
      result.disk = { total: diskParts[0], used: diskParts[1], avail: diskParts[2], pct: diskParts[3] };
    }

    // Memory
    const memParts = (sections.get('MEM') || '').split('|');
    if (memParts.length >= 3) {
      result.memory = { total: memParts[0] + 'MB', used: memParts[1] + 'MB', free: memParts[2] + 'MB' };
    }

    // Load
    result.load = sections.get('LOAD') || '?';

    // Git
    const gitParts = (sections.get('GIT') || '').split('|');
    if (gitParts.length >= 2) {
      result.git_rev = gitParts[0];
      result.git_date = gitParts[1];
    }

    // Port
    result.port_listening = (sections.get('PORT') || '').trim() !== '0';

    // SSL
    const sslVal = (sections.get('SSL') || '').trim();
    result.ssl_expires = sslVal && !sslVal.includes('ERR') ? sslVal : undefined;

    // Skills
    result.skill_count = parseInt(sections.get('SKILLS') || '0', 10);

    // Projects
    result.project_count = parseInt(sections.get('PROJECTS') || '0', 10);

    // Workspace
    result.workspace_ok = (sections.get('WORKSPACE') || '').trim() === 'OK';

  } catch (err: any) {
    result.error = err.message;
  }

  return result;
}

// ── Workspace Check ──────────────────────────────────────────────

export async function checkWorkspace(info: CustomerInfo): Promise<WorkspaceCheck> {
  const raw = await sshExec(info.ssh, `
echo "===ROOT==="
test -f ~/workspace/CLAUDE.md && echo "claude_md=true" || echo "claude_md=false"
grep -c "{{TEAM_NAME}}" ~/workspace/CLAUDE.md 2>/dev/null | xargs -I{} echo "placeholder={}"
test -f ~/workspace/principles.md && echo "principles=true" || echo "principles=false"
test -f ~/workspace/codify.md && echo "codify=true" || echo "codify=false"
test -d ~/workspace/decisions && echo "decisions=true" || echo "decisions=false"
test -d ~/workspace/docs && echo "docs=true" || echo "docs=false"
test -d ~/workspace/guide && echo "guide=true" || echo "guide=false"
ls ~/workspace/guide/ 2>/dev/null | wc -l | xargs -I{} echo "guide_files={}"
grep -c "tower-knowledge.md" ~/workspace/CLAUDE.md 2>/dev/null | xargs -I{} echo "guide_ref={}"
echo "===PROJECTS==="
for dir in ~/workspace/projects/*/; do
  name=$(basename "$dir")
  agents=$(test -f "$dir/AGENTS.md" && echo "true" || echo "false")
  symlink=$(test -L "$dir/CLAUDE.md" && echo "true" || echo "false")
  projdir=$(test -d "$dir/.project" && echo "true" || echo "false")
  progress=$(test -f "$dir/.project/progress.md" && echo "true" || echo "false")
  decisions=$(test -d "$dir/.project/decisions" && echo "true" || echo "false")
  template_only="false"
  if [ "$agents" = "true" ]; then
    lines=$(wc -l < "$dir/AGENTS.md")
    has_context=$(grep -c "^## Context" "$dir/AGENTS.md" 2>/dev/null || echo 0)
    if [ "$has_context" -gt 0 ] && [ "$lines" -lt 50 ]; then
      template_only="true"
    fi
  fi
  echo "$name|$agents|$template_only|$symlink|$projdir|$progress|$decisions"
done
  `, 20000);

  const check: WorkspaceCheck = {
    customer: info.name,
    root: {},
    projects: [],
  };

  let section = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('===')) { section = line.replace(/=/g, '').trim(); continue; }
    if (section === 'ROOT') {
      const [key, val] = line.split('=');
      if (key && val !== undefined) check.root[key] = val === 'true' ? true : val === 'false' ? false : val;
    }
    if (section === 'PROJECTS' && line.includes('|')) {
      const [name, agents, templateOnly, symlink, projdir, progress, decisions] = line.split('|');
      check.projects.push({
        name,
        agents_md: agents === 'true' ? (templateOnly === 'true' ? 'template-only' : true) : false,
        claude_symlink: symlink === 'true',
        project_dir: projdir === 'true',
        progress_md: progress === 'true',
        decisions_dir: decisions === 'true',
      });
    }
  }

  return check;
}

// ── Remote Logs ──────────────────────────────────────────────────

export async function getLogs(info: CustomerInfo, lines = 30): Promise<string> {
  return sshExec(info.ssh, `pm2 logs tower-prod --lines ${lines} --nostream 2>&1`, 10000);
}

// ── Remote Command ───────────────────────────────────────────────

export async function remoteExec(info: CustomerInfo, command: string): Promise<string> {
  // Safety: block dangerous commands
  const blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'shutdown', 'reboot', 'halt'];
  if (blocked.some(b => command.includes(b))) {
    throw new Error('Blocked: dangerous command');
  }
  return sshExec(info.ssh, command, 30000);
}
