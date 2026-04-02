/**
 * Heartbeat Service — Proactive periodic awareness for projects.
 *
 * Two modes:
 *   1. Legacy: Reads HEARTBEAT.md (manual checklist monitoring)
 *   2. Project evolution: Reads .project/progress.md + state.json,
 *      detects accumulated delta, suggests AGENTS.md refresh
 *
 * Autonomy levels:
 *   L0 — Read only, never report (silent monitoring)
 *   L1 — Surface observations to room/notifications
 *   L2 — Detect + auto-execute task (e.g., /agents-md --evolve via task-runner)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getEngine } from '../engines/index.js';
import { getModelDefaults } from '../config.js';
import { createNotification, sendMessage, getMembers } from './room-manager.js';
import { query } from '../db/pg-repo.js';

// ── Types ─────────────────────────────────────────────────────────

export type BroadcastFn = (type: string, data: any) => void;

export interface HeartbeatConfig {
  projectId: string;
  projectName: string;
  projectPath: string;       // workspace root for this project
  roomId?: string;            // associated room (if any)
  intervalMinutes: number;    // unused — daily cron at runHour
  autonomyLevel: 0 | 1 | 2;  // L0=silent / L1=notify / L2=auto-execute
  enabled: boolean;
  // ── Configurable fields (saved/restored from admin UI) ──
  runHour?: number;           // 0-23, default 3 (3 AM)
  deltaThreshold?: number;    // min progress.md lines to trigger, default 5
  action?: string;            // L2 action prompt (default: "/agents-md --evolve")
}

interface HeartbeatResult {
  status: 'ok' | 'report';
  summary?: string;           // only if status === 'report'
  items?: string[];           // individual observations
}

interface ProjectState {
  lastAgentsUpdate: string | null;
  lastProgressLine: number;
  cycle: number;
  changeLog: any[];
}

// ── State ─────────────────────────────────────────────────────────

const heartbeats = new Map<string, HeartbeatConfig>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let broadcastFn: BroadcastFn | null = null;

const HEARTBEAT_INTERVAL = 60_000; // check every 60s if it's time
const DAILY_RUN_HOUR = 3; // default 3 AM KST (server timezone)

// ── Growth Limits ────────────────────────────────────────────────
const PROGRESS_ARCHIVE_THRESHOLD = 300; // lines — archive when exceeded
const STATE_CHANGELOG_MAX = 20;          // keep only last N changeLog entries

// ── Project State Helpers ────────────────────────────────────────

async function readProjectState(projectPath: string): Promise<ProjectState | null> {
  try {
    const raw = await readFile(join(projectPath, '.project', 'state.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeProjectState(projectPath: string, state: ProjectState): Promise<void> {
  try {
    await writeFile(
      join(projectPath, '.project', 'state.json'),
      JSON.stringify(state, null, 2),
      'utf-8',
    );
  } catch (err: any) {
    console.error(`[heartbeat] Failed to write state.json:`, err.message);
  }
}

async function readProgressMd(projectPath: string): Promise<string | null> {
  try {
    const content = await readFile(join(projectPath, '.project', 'progress.md'), 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Count lines in progress.md to detect delta since last AGENTS.md update.
 */
async function getProgressDelta(projectPath: string, state: ProjectState): Promise<{
  totalLines: number;
  newLines: number;
  deltaContent: string | null;
}> {
  const progress = await readProgressMd(projectPath);
  if (!progress) return { totalLines: 0, newLines: 0, deltaContent: null };

  const lines = progress.split('\n');
  const totalLines = lines.length;
  const newLines = Math.max(0, totalLines - state.lastProgressLine);

  if (newLines <= 0) return { totalLines, newLines: 0, deltaContent: null };

  // Extract only the new content
  const deltaContent = lines.slice(state.lastProgressLine).join('\n').trim();
  return { totalLines, newLines, deltaContent: deltaContent || null };
}

/**
 * Archive old progress.md content when it exceeds threshold.
 * Moves everything except the header + last 50 lines to .project/progress-archive/YYYY-MM.md.
 * Resets lastProgressLine in state.json so delta tracking stays accurate.
 */
async function archiveProgressIfNeeded(projectPath: string, state: ProjectState): Promise<boolean> {
  const progressPath = join(projectPath, '.project', 'progress.md');
  const progress = await readProgressMd(projectPath);
  if (!progress) return false;

  const lines = progress.split('\n');
  if (lines.length < PROGRESS_ARCHIVE_THRESHOLD) return false;

  // Keep header (first 4 lines = title + blank + comments) + last 50 lines
  const headerLines = lines.slice(0, 4);
  const keepLines = lines.slice(-50);
  const archiveLines = lines.slice(4, lines.length - 50);

  if (archiveLines.length < 10) return false; // not worth archiving

  // Write archive file
  const now = new Date();
  const archiveDir = join(projectPath, '.project', 'progress-archive');
  await mkdir(archiveDir, { recursive: true });

  const archiveFile = join(archiveDir, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.md`);

  // Append to existing archive file (same month) or create new
  let existing = '';
  try { existing = await readFile(archiveFile, 'utf-8'); } catch { /* new file */ }
  const archiveContent = existing
    ? `${existing}\n${archiveLines.join('\n')}`
    : `# Progress Archive — ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}\n\n${archiveLines.join('\n')}`;
  await writeFile(archiveFile, archiveContent, 'utf-8');

  // Rewrite progress.md with header + kept lines
  const newContent = [...headerLines, '', '<!-- Older entries archived to .project/progress-archive/ -->', '', ...keepLines].join('\n');
  await writeFile(progressPath, newContent, 'utf-8');

  // Adjust lastProgressLine — new file is shorter
  const newTotalLines = newContent.split('\n').length;
  await writeProjectState(projectPath, {
    ...state,
    lastProgressLine: Math.min(state.lastProgressLine, newTotalLines),
  });

  console.log(`[heartbeat] Archived ${archiveLines.length} lines from progress.md → ${archiveFile}`);
  return true;
}

/**
 * Trim state.json changeLog to prevent unbounded growth.
 */
function trimChangeLog(state: ProjectState): ProjectState {
  if (state.changeLog && state.changeLog.length > STATE_CHANGELOG_MAX) {
    return {
      ...state,
      changeLog: state.changeLog.slice(-STATE_CHANGELOG_MAX),
    };
  }
  return state;
}

// ── Legacy: HEARTBEAT.md ─────────────────────────────────────────

async function readHeartbeatMd(projectPath: string): Promise<string | null> {
  try {
    const content = await readFile(join(projectPath, 'HEARTBEAT.md'), 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

// ── Core ──────────────────────────────────────────────────────────

/**
 * Run a heartbeat check using a lightweight AI model.
 */
async function runHeartbeatCheck(
  checklist: string,
  projectName: string,
): Promise<HeartbeatResult> {
  const defaults = getModelDefaults();
  const model = defaults.ai_reply;

  const engine = await getEngine('claude');

  const systemPrompt = `You are a project heartbeat monitor for "${projectName}".
Check the following items and report ONLY if something needs attention.
If everything looks fine, respond with exactly: HEARTBEAT_OK

Rules:
- Be extremely concise (1-2 sentences per item max)
- Only report items that need human attention
- If nothing needs attention, respond HEARTBEAT_OK
- Never take actions, only observe and report`;

  const prompt = `Checklist:\n${checklist}`;

  try {
    let fullText = '';
    const response = await engine.quickReply(prompt, {
      model,
      systemPrompt,
      onChunk: (_chunk: string, full: string) => { fullText = full; },
    });
    const text = (response || fullText).trim();

    if (text === 'HEARTBEAT_OK' || text.includes('HEARTBEAT_OK')) {
      return { status: 'ok' };
    }

    const items = text
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0 && !l.startsWith('#'));

    return {
      status: 'report',
      summary: items.slice(0, 3).join(' | '),
      items,
    };
  } catch (err: any) {
    console.error(`[heartbeat] AI check failed for ${projectName}:`, err.message);
    return { status: 'ok' };
  }
}

/**
 * Run a project evolution check — is AGENTS.md refresh needed?
 */
async function runEvolutionCheck(
  projectName: string,
  agentsMdContent: string,
  deltaContent: string,
  newLines: number,
): Promise<HeartbeatResult> {
  const defaults = getModelDefaults();
  const model = defaults.ai_reply;

  const engine = await getEngine('claude');

  const systemPrompt = `You are a project evolution monitor for "${projectName}".
Your job: determine if the project's AGENTS.md needs updating based on new progress.

Rules:
- Compare the current AGENTS.md against the new progress entries
- If the progress reveals new context, conventions, decisions, or direction changes
  that are NOT yet reflected in AGENTS.md → report what should be added/updated
- If AGENTS.md is already up to date → respond HEARTBEAT_OK
- Be concise: 1 sentence per suggested change
- Focus on non-discoverable knowledge (things a fresh agent would get wrong)`;

  const prompt = `## Current AGENTS.md
${agentsMdContent.slice(0, 2000)}

## New progress entries (${newLines} lines since last update)
${deltaContent.slice(0, 2000)}

Is AGENTS.md still accurate, or does it need updating?`;

  try {
    let fullText = '';
    const response = await engine.quickReply(prompt, {
      model,
      systemPrompt,
      onChunk: (_chunk: string, full: string) => { fullText = full; },
    });
    const text = (response || fullText).trim();

    if (text.includes('HEARTBEAT_OK')) {
      return { status: 'ok' };
    }

    const items = text
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0 && !l.startsWith('#'));

    return {
      status: 'report',
      summary: `AGENTS.md 갱신 제안 (${items.length}건)`,
      items,
    };
  } catch (err: any) {
    console.error(`[heartbeat] Evolution check failed for ${projectName}:`, err.message);
    return { status: 'ok' };
  }
}

/**
 * Execute a single heartbeat tick for one project.
 */
async function executeHeartbeat(config: HeartbeatConfig): Promise<void> {
  // L0: read only, never report
  if (config.autonomyLevel === 0) {
    return;
  }

  // ── Mode 1: Project evolution (.project/state.json exists) ──
  let state = await readProjectState(config.projectPath);
  if (state) {
    // Housekeeping: archive bloated progress.md, trim changeLog
    await archiveProgressIfNeeded(config.projectPath, state);
    state = trimChangeLog(state);

    const { totalLines, newLines, deltaContent } = await getProgressDelta(config.projectPath, state);
    const threshold = config.deltaThreshold ?? 5;

    // Need enough new lines to trigger a check
    if (newLines < threshold || !deltaContent) {
      console.log(`[heartbeat] "${config.projectName}" — progress delta: ${newLines} lines (threshold: ${threshold}), skipping`);
      return;
    }

    console.log(`[heartbeat] "${config.projectName}" — ${newLines} new progress lines, running evolution check`);

    // Read current AGENTS.md
    let agentsMd = '';
    try {
      agentsMd = await readFile(join(config.projectPath, 'AGENTS.md'), 'utf-8');
    } catch {}

    const result = await runEvolutionCheck(config.projectName, agentsMd, deltaContent, newLines);

    if (result.status === 'ok') {
      console.log(`[heartbeat] "${config.projectName}" — AGENTS.md still current`);
      await writeProjectState(config.projectPath, trimChangeLog({
        ...state,
        lastProgressLine: totalLines,
      }));
      return;
    }

    // ── L2: Auto-execute task via task-runner ──
    if (config.autonomyLevel === 2) {
      const actionPrompt = config.action || '/agents-md --evolve';
      console.log(`[heartbeat] "${config.projectName}" — L2 auto-execute: "${actionPrompt}"`);

      try {
        const { createTask } = await import('./task-manager.js');
        const { spawnTask } = await import('./task-runner.js');

        const task = await createTask(
          `🫀 Heartbeat: ${config.projectName}`,
          `Automated heartbeat task — progress.md에 ${newLines}줄 축적됨.\n\n**실행할 작업:**\n${actionPrompt}\n\n**감지된 변화:**\n${deltaContent}\n\n**현재 AGENTS.md 요약:**\n${agentsMd.slice(0, 500)}...`,
          config.projectPath,
          undefined,         // system task, no userId
          undefined,         // default model
          undefined,         // no scheduling
          'default',         // workflow
          undefined,         // no parent
          config.projectId,  // project association
          config.roomId ? {
            roomId: config.roomId,
            triggeredBy: 0,
            roomMessageId: '',
          } : undefined,
        );

        if (broadcastFn) {
          await spawnTask(task.id, broadcastFn, undefined, 'admin', config.projectPath);
        }

        console.log(`[heartbeat] "${config.projectName}" — task spawned: ${task.id}`);

        // Notify about auto-execution
        const messageContent = `**🤖 Heartbeat Auto-Execute** — ${config.projectName}\n\nprogress.md에 ${newLines}줄 축적 → 자동 실행 시작\n**Action:** \`${actionPrompt}\`\n**Task:** ${task.id}`;
        await deliverReport(config, messageContent, result);
      } catch (err: any) {
        console.error(`[heartbeat] "${config.projectName}" — L2 task spawn failed:`, err.message);
        // Fall back to L1 behavior (just notify)
        const messageContent = `**⚠️ Heartbeat Auto-Execute Failed** — ${config.projectName}\n\nTask 생성 실패: ${err.message}\n\n수동으로 \`/agents-md --evolve\`를 실행해주세요.`;
        await deliverReport(config, messageContent, result);
      }
    } else {
      // ── L1: Notify only ──
      console.log(`[heartbeat] "${config.projectName}" — ${result.items?.length ?? 0} evolution suggestion(s)`);

      const messageContent = `**🔄 Project Evolution** — ${config.projectName}\n\nprogress.md에 ${newLines}줄이 축적되었습니다. AGENTS.md 갱신을 권장합니다.\n\n**제안사항:**\n${result.items?.map((i: string) => `- ${i}`).join('\n') ?? ''}\n\n> \`/agents-md --evolve\`로 갱신할 수 있습니다.`;

      await deliverReport(config, messageContent, result);
    }

    // Update state so we don't re-trigger the same delta
    await writeProjectState(config.projectPath, trimChangeLog({
      ...state,
      lastProgressLine: totalLines,
    }));
    return;
  }

  // ── Mode 2: Legacy HEARTBEAT.md ──
  const checklist = await readHeartbeatMd(config.projectPath);
  if (!checklist) {
    return; // no .project/ and no HEARTBEAT.md — nothing to check
  }

  console.log(`[heartbeat] Running legacy check for "${config.projectName}" (L${config.autonomyLevel})`);

  const result = await runHeartbeatCheck(checklist, config.projectName);

  if (result.status === 'ok') {
    console.log(`[heartbeat] "${config.projectName}" — HEARTBEAT_OK`);
    return;
  }

  console.log(`[heartbeat] "${config.projectName}" — ${result.items?.length ?? 0} observation(s)`);

  const messageContent = `**Heartbeat Report** — ${config.projectName}\n\n${result.items?.map((i: string) => `- ${i}`).join('\n') ?? result.summary}`;

  await deliverReport(config, messageContent, result);
}

/**
 * Deliver a heartbeat report to room + notifications.
 */
async function deliverReport(
  config: HeartbeatConfig,
  messageContent: string,
  result: HeartbeatResult,
): Promise<void> {
  // Post to room if configured
  if (config.roomId) {
    try {
      const savedMsg = await sendMessage(
        config.roomId,
        null,
        messageContent,
        'system',
        { heartbeat: true, projectId: config.projectId },
      );

      broadcastFn?.('room_message', {
        roomId: config.roomId,
        message: {
          id: savedMsg.id,
          roomId: config.roomId,
          senderId: null,
          senderName: 'Heartbeat',
          msgType: 'system',
          content: messageContent,
          metadata: { heartbeat: true },
          createdAt: savedMsg.createdAt,
        },
      });
    } catch (err: any) {
      console.error(`[heartbeat] Failed to post to room:`, err.message);
    }
  }

  // Send personal notifications to project members
  if (config.roomId) {
    try {
      const members = await getMembers(config.roomId);
      for (const member of members) {
        const notifId = await createNotification(
          member.userId,
          config.roomId,
          'heartbeat',
          `Heartbeat: ${config.projectName}`,
          result.summary ?? result.items?.[0],
          { projectId: config.projectId, items: result.items },
        );

        broadcastFn?.('notification', {
          targetUserId: member.userId,
          notification: {
            id: notifId,
            userId: member.userId,
            roomId: config.roomId,
            type: 'heartbeat',
            title: `Heartbeat: ${config.projectName}`,
            body: result.summary ?? result.items?.[0],
            metadata: { projectId: config.projectId },
            read: false,
            createdAt: new Date().toISOString(),
          },
        });

        import('./messaging/index.js').then(({ messageRouter }) => {
          messageRouter.sendAny(member.userId, result.summary ?? result.items?.[0] ?? '', {
            title: `🫀 Heartbeat: ${config.projectName}`,
            linkUrl: 'https://tower.moatai.app',
            buttonTitle: 'Tower 열기',
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error(`[heartbeat] Failed to send notifications:`, err.message);
    }
  }
}

/**
 * Heartbeat scheduler tick — checks every minute, runs projects whose runHour matches.
 * Each project tracks its own last-run date to prevent double execution.
 */
const lastRunDates = new Map<string, string>(); // projectId → 'YYYY-MM-DD'

async function tick(): Promise<void> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const hour = now.getHours();

  const enabled = [...heartbeats.values()].filter(c => c.enabled);
  if (enabled.length === 0) return;

  // Filter to projects whose runHour matches current hour and haven't run today
  const due = enabled.filter(c => {
    const targetHour = c.runHour ?? DAILY_RUN_HOUR;
    if (hour !== targetHour) return false;
    if (lastRunDates.get(c.projectId) === today) return false;
    return true;
  });

  if (due.length === 0) return;

  console.log(`[heartbeat] Running ${due.length} project(s) at hour ${hour}`);

  // Run sequentially to avoid overloading (1 AI call per project max)
  for (const config of due) {
    lastRunDates.set(config.projectId, today);
    try {
      await executeHeartbeat(config);
    } catch (err: any) {
      console.error(`[heartbeat] Error for ${config.projectName}:`, err.message);
    }
  }

  console.log(`[heartbeat] Daily run complete`);
}

// ── Auto-registration ────────────────────────────────────────────

/**
 * Scan all projects in DB for .project/state.json and auto-register heartbeats.
 * Called once on server boot.
 */
export async function autoRegisterProjectHeartbeats(): Promise<void> {
  try {
    const projects = await query<{ id: string; name: string; root_path: string }>(
      `SELECT id, name, root_path FROM projects WHERE (archived IS NULL OR archived = 0) AND root_path IS NOT NULL`
    );

    let registered = 0;
    for (const p of projects) {
      if (!p.root_path) continue;
      // Register if .project/state.json exists (seeded by project-manager)
      const stateFile = join(p.root_path, '.project', 'state.json');
      if (existsSync(stateFile)) {
        registerHeartbeat({
          projectId: p.id,
          projectName: p.name,
          projectPath: p.root_path,
          intervalMinutes: 0, // unused — daily cron at DAILY_RUN_HOUR
          autonomyLevel: 1,
          enabled: true,
        });
        registered++;
      }
    }

    if (registered > 0) {
      console.log(`[heartbeat] Auto-registered ${registered} project(s) for evolution monitoring`);
    }
  } catch (err: any) {
    console.error(`[heartbeat] Auto-registration failed:`, err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────

export function registerHeartbeat(config: HeartbeatConfig): void {
  heartbeats.set(config.projectId, config);
  const h = config.runHour ?? DAILY_RUN_HOUR;
  console.log(`[heartbeat] Registered "${config.projectName}" (daily ${h}:00, L${config.autonomyLevel}, Δ≥${config.deltaThreshold ?? 5})`);
}

export function unregisterHeartbeat(projectId: string): void {
  heartbeats.delete(projectId);
  console.log(`[heartbeat] Unregistered ${projectId}`);
}

export function updateHeartbeat(projectId: string, updates: Partial<HeartbeatConfig>): void {
  const existing = heartbeats.get(projectId);
  if (existing) {
    heartbeats.set(projectId, { ...existing, ...updates });
  }
}

export function getHeartbeatConfig(projectId: string): HeartbeatConfig | undefined {
  return heartbeats.get(projectId);
}

export function listHeartbeats(): HeartbeatConfig[] {
  return Array.from(heartbeats.values());
}

/**
 * Manually trigger heartbeat for a single project (by projectId) or all projects.
 * Returns summary of what happened.
 */
export async function runHeartbeatNow(projectId?: string): Promise<{ ran: number; results: string[] }> {
  const targets = projectId
    ? [heartbeats.get(projectId)].filter(Boolean) as HeartbeatConfig[]
    : [...heartbeats.values()].filter(c => c.enabled);

  const results: string[] = [];
  for (const config of targets) {
    try {
      await executeHeartbeat(config);
      results.push(`✅ ${config.projectName}`);
    } catch (err: any) {
      results.push(`❌ ${config.projectName}: ${err.message}`);
    }
  }
  return { ran: targets.length, results };
}

export function startHeartbeatScheduler(broadcast: BroadcastFn): void {
  if (heartbeatTimer) {
    console.warn('[heartbeat] Already running');
    return;
  }
  broadcastFn = broadcast;
  heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL);

  // Auto-register projects on start (async, don't block)
  autoRegisterProjectHeartbeats().catch(err => {
    console.error('[heartbeat] Auto-registration error:', err.message);
  });

  console.log('[heartbeat] Scheduler started');
}

export function stopHeartbeatScheduler(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('[heartbeat] Scheduler stopped');
  }
}
