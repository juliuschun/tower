/**
 * Engine abstraction layer — Tower's multi-engine agent system.
 *
 * Each engine (Claude, Pi, future engines) implements the Engine interface
 * and converts its native events to TowerMessage format.
 *
 * Design principle: ws-handler.ts and the frontend never import engine-specific code.
 * Removing an engine = deleting its file + 1 line in index.ts.
 */

// ═══════════════════════════════════════════════════════════════════
// TowerContentBlock — engine-independent content representation
// ═══════════════════════════════════════════════════════════════════

export type TowerContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; title?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> };

// ═══════════════════════════════════════════════════════════════════
// TowerMessage — what engines yield, ws-handler broadcasts, frontend handles
// ═══════════════════════════════════════════════════════════════════

/** Streamed assistant message update (cumulative content) */
export interface TowerAssistantMsg {
  type: 'assistant';
  sessionId: string;
  msgId: string;
  content: TowerContentBlock[];
  parentToolUseId?: string | null;
}

/** Tool execution result (user message from SDK) */
export interface TowerToolResultMsg {
  type: 'tool_result';
  sessionId: string;
  msgId: string;
  toolCallId: string;
  toolName: string;
  result: string;
  isError?: boolean;
  parentToolUseId?: string | null;
}

/** Turn complete — usage, cost, timing */
export interface TowerTurnDoneMsg {
  type: 'turn_done';
  sessionId: string;
  msgId: string;
  usage: TowerUsage;
}

/** Engine finished processing (all turns done) */
export interface TowerDoneMsg {
  type: 'engine_done';
  sessionId: string;
  engineSessionId?: string;
  editedFiles?: string[];
  model?: string;
}

/** Error from engine */
export interface TowerErrorMsg {
  type: 'engine_error';
  sessionId: string;
  message: string;
  recoverable?: boolean;
}

/** Autocompact lifecycle events — forwarded to frontend for UI feedback */
export interface TowerCompactMsg {
  type: 'compact';
  sessionId: string;
  /** 'boundary' = compaction about to start, 'compacting' = in progress, 'done' = finished */
  phase: 'boundary' | 'compacting' | 'done';
}

export type TowerMessage =
  | TowerAssistantMsg
  | TowerToolResultMsg
  | TowerTurnDoneMsg
  | TowerDoneMsg
  | TowerErrorMsg
  | TowerCompactMsg;

// Note: ask_user is handled via EngineCallbacks, not yielded as TowerMessage.
// ws-handler owns pending question state for reconnection/session-switch.

export interface TowerUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;       // Pi: auto-calculated, Claude Max: undefined (subscription)
  durationMs: number;
  stopReason?: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
  // Context window tracking (last iteration = real context size, not cumulative)
  contextInputTokens?: number;
  contextOutputTokens?: number;
  contextWindowSize?: number;   // model's context window (e.g. 200000)
  numIterations?: number;       // how many API calls in this turn
}

// ═══════════════════════════════════════════════════════════════════
// Engine interface
// ═══════════════════════════════════════════════════════════════════

export interface RunOpts {
  cwd: string;
  model?: string;
  userId?: number;
  username?: string;
  userRole?: string;
  allowedPath?: string;
  /**
   * Project-based accessible paths for this user.
   * All project folders the user is a member of + public areas.
   * null = unrestricted (admin). undefined = not computed yet (legacy).
   * Computed by ws-handler/task-runner BEFORE calling engine.run().
   * Each engine uses this in its own way (canUseTool, tool wrapper, etc).
   */
  accessiblePaths?: string[] | null;
  engineSessionId?: string;   // for resume (read from DB by ws-handler)
}

export interface EngineCallbacks {
  /**
   * Pause execution to ask the user a question.
   * ws-handler manages the WS broadcasting and pending question state.
   * Returns the raw answer string from the user.
   *
   * @param questionId - unique ID for this question
   * @param questions - raw question data (engine-specific format, ws-handler forwards as-is)
   */
  askUser(questionId: string, questions: any[]): Promise<string>;

  /** Persist engine-specific session ID for resume */
  claimSessionId(engineSessionId: string): void | Promise<void>;

  /** Save a message to DB */
  saveMessage(msg: SavedMessage): void | Promise<void>;

  /** Update message content (streaming updates) */
  updateMessageContent(msgId: string, content: any[]): void | Promise<void>;

  /** Attach tool result to an existing tool_use message in DB */
  attachToolResult(toolUseId: string, result: string): void | Promise<void>;

  /** Update message metrics after turn completes */
  updateMessageMetrics(msgId: string, metrics: MessageMetrics): void | Promise<void>;
}

export interface SavedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: any[];
  parentToolUseId?: string | null;
}

export interface MessageMetrics {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * QuickReply options — lightweight single-turn response (no session/task).
 * Used by @ai in chat rooms.
 */
export interface QuickReplyOpts {
  model?: string;
  systemPrompt: string;
  /** Callback for each text chunk (for streaming to room) */
  onChunk: (chunk: string, fullContent: string) => void;
}

export interface Engine {
  /** Execute a prompt. Yields TowerMessages for ws-handler to broadcast. */
  run(
    sessionId: string,
    prompt: string,
    opts: RunOpts,
    callbacks: EngineCallbacks,
  ): AsyncGenerator<TowerMessage>;

  /**
   * Lightweight single-turn text response. No session, no tools.
   * Used by @ai quick reply in chat rooms.
   * Returns the full response text.
   */
  quickReply(prompt: string, opts: QuickReplyOpts): Promise<string>;

  /** Abort a running session */
  abort(sessionId: string): void;

  /** Clean up session resources (on session delete) */
  dispose(sessionId: string): void;

  /** Check if session is currently running */
  isRunning(sessionId: string): boolean;

  /** Count of active (running) sessions */
  getActiveCount(): number;

  /** IDs of all currently running sessions (for reconnection state) */
  getRunningSessionIds(): string[];

  /** Server startup initialization (e.g. orphan cleanup) */
  init?(): void;

  /** Server shutdown cleanup */
  shutdown?(): void;
}
