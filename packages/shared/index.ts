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
  claudeSessionId?: string;
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
  filesEdited?: string[];
  projectId?: string | null;
  engine?: string;
  visibility?: 'private' | 'project';
  roomId?: string | null;
}

// ── Task ─────────────────────────────────────────────────────────

export type WorkflowMode = 'auto' | 'simple' | 'default' | 'feature' | 'big_task';

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
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  scheduledAt: string | null;
  scheduleCron: string | null;
  scheduleEnabled: boolean;
  workflow: WorkflowMode;
  parentTaskId: string | null;
  worktreePath: string | null;
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
  source: 'bundled' | 'custom';
  projectId?: string | null;
  userId?: number | null;
  createdAt: string;
  updatedAt: string;
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
