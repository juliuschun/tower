import { create } from 'zustand';
import { useMemo } from 'react';
import { useSessionStore } from './session-store';

export interface ModelOption {
  id: string;
  name: string;
  badge: string;
}

export interface ModelDefaults {
  session: string;
  ai_reply: string;
  ai_task: string;
}

const DEFAULT_DEFAULTS: ModelDefaults = {
  session: 'claude-opus-4-6',
  ai_reply: 'claude-haiku-4-5-20251001',
  ai_task: 'claude-sonnet-4-6',
};

interface ModelState {
  availableModels: ModelOption[];
  piModels: ModelOption[];
  selectedModel: string;
  connectionType: string;
  defaults: ModelDefaults;

  setAvailableModels: (models: ModelOption[]) => void;
  setPiModels: (models: ModelOption[]) => void;
  setSelectedModel: (id: string) => void;
  setConnectionType: (type: string) => void;
  setDefaults: (defaults: ModelDefaults) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  availableModels: [],
  piModels: [],
  selectedModel: localStorage.getItem('selectedModel') || DEFAULT_DEFAULTS.session,
  connectionType: 'MAX',
  defaults: DEFAULT_DEFAULTS,

  setAvailableModels: (models) => set({ availableModels: models }),
  setPiModels: (models) => set({ piModels: models }),
  setSelectedModel: (id) => {
    localStorage.setItem('selectedModel', id);
    set({ selectedModel: id });
  },
  setConnectionType: (type) => set({ connectionType: type }),
  setDefaults: (defaults) => set({ defaults }),
}));

/** Extract engine from model ID. 'pi:openrouter/...' → 'pi', otherwise 'claude' */
export function getEngineFromModel(modelId: string): 'claude' | 'pi' {
  return modelId.startsWith('pi:') ? 'pi' : 'claude';
}

/** Strip engine prefix from model ID for backend. 'pi:openrouter/...' → 'openrouter/...' */
export function getModelIdForBackend(modelId: string): string {
  return modelId.startsWith('pi:') ? modelId.slice(3) : modelId;
}

/**
 * Convert a session's stored `modelUsed` (DB format, no prefix) to the
 * frontend ID format (with `pi:` prefix for pi-engine sessions).
 * Returns undefined if the session has no stored model.
 */
export function modelIdFromSession(
  session: { engine?: string; modelUsed?: string } | null | undefined,
): string | undefined {
  if (!session?.modelUsed) return undefined;
  if (session.engine === 'pi' && !session.modelUsed.startsWith('pi:')) {
    return `pi:${session.modelUsed}`;
  }
  return session.modelUsed;
}

/**
 * Resolve the effective model for a chat send:
 * - active session's stored modelUsed takes precedence (per-session intent)
 * - fall back to the global selectedModel (default for new sessions)
 *
 * The backend additionally validates/falls back again, so even if this
 * returns a mismatched model it won't crash — but matching here keeps
 * the UI and the actual turn in sync.
 */
export function resolveEffectiveModel(
  session: { engine?: string; modelUsed?: string } | null | undefined,
  globalSelected: string,
): string {
  return modelIdFromSession(session) ?? globalSelected;
}

/**
 * Session-aware model picker — shared by ModelSelector (desktop) and the
 * Header's inline mobile selector.
 *
 * Returns:
 *  - `effectiveSelected`: the frontend model ID that should be shown as picked
 *  - `sessionEngine`: engine of the active session (or undefined if none)
 *  - `visibleClaudeModels` / `visiblePiModels`: dropdown groups filtered by engine
 *  - `pick(modelId)`: update either the session's modelUsed (+ PATCH backend)
 *     or the global default if no session is active
 */
export function useSessionAwareModel() {
  const availableModels = useModelStore((s) => s.availableModels);
  const piModels = useModelStore((s) => s.piModels);
  const selectedModel = useModelStore((s) => s.selectedModel);
  const setSelectedModel = useModelStore((s) => s.setSelectedModel);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const updateSessionMeta = useSessionStore((s) => s.updateSessionMeta);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );

  const effectiveSelected = resolveEffectiveModel(activeSession, selectedModel);
  const sessionEngine = activeSession?.engine as 'claude' | 'pi' | undefined;

  const visibleClaudeModels =
    !sessionEngine || sessionEngine === 'claude' ? availableModels : [];
  const visiblePiModels =
    !sessionEngine || sessionEngine === 'pi' ? piModels : [];

  const pick = (modelId: string) => {
    if (!activeSession) {
      setSelectedModel(modelId);
      return;
    }
    const picked = getEngineFromModel(modelId);
    if (sessionEngine && picked !== sessionEngine) {
      console.warn(
        `[useSessionAwareModel] refusing to set ${modelId} on a ${sessionEngine} session`,
      );
      return;
    }
    const backendModel = getModelIdForBackend(modelId);
    updateSessionMeta(activeSession.id, { modelUsed: backendModel });

    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`/api/sessions/${activeSession.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ modelUsed: backendModel }),
    }).catch((err) => {
      console.warn('[useSessionAwareModel] failed to persist modelUsed:', err);
    });

    setSelectedModel(modelId);
  };

  return {
    effectiveSelected,
    sessionEngine,
    visibleClaudeModels,
    visiblePiModels,
    pick,
  };
}
