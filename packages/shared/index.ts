/**
 * @tower/shared — Base types shared between frontend and backend.
 *
 * These are the API-boundary types: fields that cross HTTP/WebSocket.
 * Backend and frontend extend these with their own fields as needed.
 *
 * INVARIANT: This package has ZERO runtime dependencies.
 */

// ── Session ──────────────────────────────────────────────────────

export interface SessionMeta {
  id: string;
  /** Legacy field name kept for compatibility while frontend/backend migrate to engine-neutral naming. */
  claudeSessionId?: string;
  /** Engine-neutral alias for claudeSessionId / future engine session identifiers. */
  engineSessionId?: string;
  name: string;
  cwd: string;
  tags: string[];
  favorite: boolean;
  totalCost: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
  modelUsed?: string;
  autoNamed?: number;
  summary?: string;
  summaryAtTurn?: number;
  turnCount?: number;
  /** Real user-initiated turns (messages with role='user' + type='text').
   *  Excludes tool_result bounces and intermediate assistant tool_use/thinking.
   *  Computed live by getSessions() via a LEFT JOIN over a partial index. */
  userTurnCount?: number;
  filesEdited?: string[];
  projectId?: string | null;
  engine?: string;
  visibility?: 'private' | 'project';
  roomId?: string | null;
  parentSessionId?: string | null;
  sourceMessageId?: string | null;
  ownerUsername?: string | null;
  label?: string | null;
}

// ── Task ─────────────────────────────────────────────────────────

export type WorkflowMode = 'auto' | 'simple' | 'default' | 'feature' | 'big_task';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TaskMeta {
  id: string;
  title: string;
  description: string;
  cwd: string;
  model: string;
  status: 'todo' | 'in_progress' | 'done' | 'failed';
  sessionId: string | null;
  sortOrder: number;
  progressSummary: string[];
  todoSnapshot: TodoItem[] | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  scheduledAt: string | null;
  scheduleCron: string | null;
  scheduleEnabled: boolean;
  workflow: WorkflowMode;
  parentTaskId: string | null;
  worktreePath: string | null;
  projectId: string | null;
  roomId: string | null;
  triggeredBy: number | null;
  roomMessageId: string | null;
  userId: number | null;
}

// ── Schedule ────────────────────────────────────────────────────

export interface ScheduleEntry {
  id: string;
  userId: number;
  projectId: string | null;
  name: string;
  prompt: string;
  model: string;
  mode: 'spawn' | 'inject' | 'channel';
  targetId: string | null;
  triggerType: 'cron' | 'once';
  cronConfig: ScheduleCronConfig | null;
  onceAt: string | null;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleCronConfig {
  type: 'daily' | 'weekdays' | 'weekly' | 'interval';
  hour?: number;
  minute?: number;
  day?: number;
  hours?: number;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  status: string;
  mode: string;
  resultId: string | null;
  error: string | null;
  durationMs: number | null;
  ranAt: string;
}

// ── Automation ──────────────────────────────────────────────────

export type AutomationMode = 'spawn' | 'inject' | 'channel';
export type AutomationTrigger = 'manual' | 'cron' | 'once' | 'event';
export type AutomationStatus = 'idle' | 'running' | 'done' | 'failed' | 'archived';

export interface Automation {
  id: string;
  userId: number;
  projectId: string | null;
  name: string;
  description: string;
  prompt: string;
  model: string;
  workflow: string;
  mode: AutomationMode;
  targetId: string | null;
  cwd: string | null;
  triggerType: AutomationTrigger;
  cronConfig: AutomationCronConfig | null;
  onceAt: string | null;
  status: AutomationStatus;
  enabled: boolean;
  sortOrder: number;
  sessionId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  lastStatus: string | null;
  lastError: string | null;
  progressSummary: string[];
  todoSnapshot: TodoItem[] | null;
  parentId: string | null;
  worktreePath: string | null;
  roomId: string | null;
  triggeredBy: number | null;
  roomMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AutomationCronConfig {
  type: 'daily' | 'weekdays' | 'weekly' | 'interval';
  hour?: number;
  minute?: number;
  day?: number;
  hours?: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: string;
  mode: string;
  resultId: string | null;
  error: string | null;
  durationMs: number | null;
  ranAt: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  nameKo: string;
  description: string;
  descriptionKo: string;
  icon: string;
  defaultTrigger: AutomationTrigger;
  defaultMode: AutomationMode;
  defaultCron?: AutomationCronConfig;
  promptTemplate: string;
  category: 'research' | 'development' | 'operations' | 'communication';
}

// ── Space ───────────────────────────────────────────────────────

export interface Space {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  type: 'client' | 'research' | 'internal' | 'personal' | 'custom';
  color: string;
  icon: string;
  sortOrder: number;
  archived: number;
  createdAt: string;
}

// ── Project ──────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string | null;
  rootPath: string | null;
  color: string;
  sortOrder: number;
  collapsed: number;
  archived: number;
  createdAt: string;
  spaceId: number | null;
  spaceName?: string | null;
  spaceSlug?: string | null;
  claude_account_id?: string | null;
}

// ── Pin ──────────────────────────────────────────────────────────

export interface Pin {
  id: number;
  title: string;
  file_path: string;
  file_type: string;
  sort_order: number;
  created_at: string;
}

// ── Prompt ────────────────────────────────────────────────────────

export interface PromptItem {
  id: number | string;
  title: string;
  content: string;
  source: 'user' | 'commands';
  readonly: boolean;
}

// ── File System ──────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
  extension?: string;
}

// ── Skill ────────────────────────────────────────────────────────

export type SkillScope = 'company' | 'project' | 'personal';

export interface SkillMeta {
  id: string;
  name: string;
  scope: SkillScope;
  description: string;
  category: string;
  enabled: boolean;
  /** Per-user toggle (null = no pref set, defaults to enabled) */
  userEnabled?: boolean | null;
  source: 'bundled' | 'custom' | 'marketplace' | 'official' | 'library';
  skillPath?: string | null;
  projectId?: string | null;
  userId?: number | null;
  createdAt: string;
  updatedAt: string;
  /** Providers this skill requires (populated from skill_providers table) */
  providers?: SkillProvider[];
}

export interface SkillProvider {
  provider: string;       // 'google', 'kakao', 'slack', 'github', ...
  required: boolean;
  scopeHint: string;      // 'gmail.readonly gmail.send', etc.
}

export interface ConnectionStatus {
  provider: string;
  connected: boolean;
  nickname?: string | null;
  expiresAt?: number | null;   // Unix timestamp (ms)
}

export interface SkillReadiness {
  skillId: string;
  skillName: string;
  ready: boolean;
  missing: string[];     // providers not yet connected
  providers: Array<SkillProvider & { connected: boolean }>;
}

// ── Git ──────────────────────────────────────────────────────────

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  authorName: string;
  message: string;
  commitType: 'auto' | 'manual' | 'rollback';
  filesChanged: string[];
  createdAt: string;
}
