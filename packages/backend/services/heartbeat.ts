/**
 * Heartbeat Service — Proactive periodic awareness for projects.
 *
 * Reads HEARTBEAT.md from project workspace, runs a lightweight AI check,
 * and posts results to the project's room (if any) + personal notifications.
 *
 * Design inspired by ai-intern-prd.md F8 (Heartbeat — Proactive Agency).
 *
 * Autonomy levels:
 *   L0 — Read only, never report (silent monitoring)
 *   L1 — Surface observations to room/notifications
 *   L2 — Take minor actions (future) and report
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { getEngine } from '../engines/index.js';
import { getModelDefaults } from '../config.js';
import { createNotification, sendMessage, getMembers } from './room-manager.js';

// ── Types ─────────────────────────────────────────────────────────

export type BroadcastFn = (type: string, data: any) => void;

export interface HeartbeatConfig {
  projectId: string;
  projectName: string;
  projectPath: string;       // workspace root for this project
  roomId?: string;            // associated room (if any)
  intervalMinutes: number;    // default 60
  autonomyLevel: 0 | 1 | 2;  // L0/L1/L2
  enabled: boolean;
}

interface HeartbeatResult {
  status: 'ok' | 'report';
  summary?: string;           // only if status === 'report'
  items?: string[];           // individual observations
}

// ── State ─────────────────────────────────────────────────────────

const heartbeats = new Map<string, HeartbeatConfig>();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let broadcastFn: BroadcastFn | null = null;

const HEARTBEAT_INTERVAL = 60_000; // check every 60s which heartbeats are due
const nextRunAt = new Map<string, number>(); // projectId → timestamp

// ── Core ──────────────────────────────────────────────────────────

/**
 * Read HEARTBEAT.md from a project's workspace.
 * Returns null if not found (heartbeat not configured for this project).
 */
async function readHeartbeatMd(projectPath: string): Promise<string | null> {
  try {
    const content = await readFile(join(projectPath, 'HEARTBEAT.md'), 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Run a single heartbeat check using a lightweight AI model.
 * Keeps it under ~500 tokens for cost efficiency.
 */
async function runHeartbeatCheck(
  checklist: string,
  projectName: string,
): Promise<HeartbeatResult> {
  const defaults = getModelDefaults();
  const model = defaults.ai_reply; // cheapest model (typically Haiku)

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

    // Parse observations
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
    return { status: 'ok' }; // fail silently — don't spam on errors
  }
}

/**
 * Execute a single heartbeat tick for one project.
 */
async function executeHeartbeat(config: HeartbeatConfig): Promise<void> {
  const checklist = await readHeartbeatMd(config.projectPath);
  if (!checklist) {
    console.log(`[heartbeat] No HEARTBEAT.md for "${config.projectName}", skipping`);
    return;
  }

  console.log(`[heartbeat] Running check for "${config.projectName}" (L${config.autonomyLevel})`);

  // L0: read only, never report
  if (config.autonomyLevel === 0) {
    console.log(`[heartbeat] L0 mode — check skipped (read-only)`);
    return;
  }

  const result = await runHeartbeatCheck(checklist, config.projectName);

  if (result.status === 'ok') {
    console.log(`[heartbeat] "${config.projectName}" — HEARTBEAT_OK`);
    return;
  }

  // L1+: Surface observations
  console.log(`[heartbeat] "${config.projectName}" — ${result.items?.length ?? 0} observation(s)`);

  const messageContent = `**Heartbeat Report** — ${config.projectName}\n\n${result.items?.map((i: string) => `- ${i}`).join('\n') ?? result.summary}`;

  // Post to room if configured
  if (config.roomId) {
    try {
      const savedMsg = await sendMessage(
        config.roomId,
        null, // system sender
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

        // Push via WS
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

        // Push to external messaging (KakaoTalk, Telegram, etc.)
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
 * Heartbeat scheduler tick — checks which heartbeats are due and runs them.
 */
async function tick(): Promise<void> {
  const now = Date.now();

  for (const [projectId, config] of heartbeats) {
    if (!config.enabled) continue;

    const nextRun = nextRunAt.get(projectId) ?? 0;
    if (now < nextRun) continue;

    // Schedule next run
    nextRunAt.set(projectId, now + config.intervalMinutes * 60_000);

    // Execute async (don't block other heartbeats)
    executeHeartbeat(config).catch(err => {
      console.error(`[heartbeat] Unhandled error for ${projectId}:`, err.message);
    });
  }
}

// ── Public API ────────────────────────────────────────────────────

export function registerHeartbeat(config: HeartbeatConfig): void {
  heartbeats.set(config.projectId, config);
  // Schedule first run after one interval (not immediately)
  nextRunAt.set(config.projectId, Date.now() + config.intervalMinutes * 60_000);
  console.log(`[heartbeat] Registered "${config.projectName}" (every ${config.intervalMinutes}m, L${config.autonomyLevel})`);
}

export function unregisterHeartbeat(projectId: string): void {
  heartbeats.delete(projectId);
  nextRunAt.delete(projectId);
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

export function startHeartbeatScheduler(broadcast: BroadcastFn): void {
  if (heartbeatTimer) {
    console.warn('[heartbeat] Already running');
    return;
  }
  broadcastFn = broadcast;
  heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL);
  console.log('[heartbeat] Scheduler started');
}

export function stopHeartbeatScheduler(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('[heartbeat] Scheduler stopped');
  }
}
