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

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const DEFAULT_DEFAULTS: ModelDefaults = {
  session: 'claude-opus-4-7',
  ai_reply: 'claude-haiku-4-5-20251001',
  ai_task: 'claude-sonnet-4-6',
};

interface ModelState {
  availableModels: ModelOption[];
  piModels: ModelOption[];
  localModels: ModelOption[];
  selectedModel: string;
  connectionType: string;
  defaults: ModelDefaults;

  setAvailableModels: (models: ModelOption[]) => void;
  setPiModels: (models: ModelOption[]) => void;
  setLocalModels: (models: ModelOption[]) => void;
  setSelectedModel: (id: string) => void;
  setConnectionType: (type: string) => void;
  setDefaults: (defaults: ModelDefaults) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  availableModels: [],
  piModels: [],
  localModels: [],
  selectedModel: localStorage.getItem('selectedModel') || DEFAULT_DEFAULTS.session,
  connectionType: 'MAX',
  defaults: DEFAULT_DEFAULTS,

  setAvailableModels: (models) => set({ availableModels: models }),
  setPiModels: (models) => set({ piModels: models }),
  setLocalModels: (models) => set({ localModels: models }),
  setSelectedModel: (id) => {
    localStorage.setItem('selectedModel', id);
    set({ selectedModel: id });
  },
  setConnectionType: (type) => set({ connectionType: type }),
  setDefaults: (defaults) => set({ defaults }),
}));

/**
 * Reconcile localStorage-persisted `selectedModel` with the server-side model
 * registry. Called once after `/api/config` loads models + defaults.
 *
 * If the persisted model is no longer registered (e.g. an admin retired
 * `claude-opus-4-6` in models.json), fall back to the admin-configured session
 * default. This prevents footer badges and new-session creation from using a
 * stale model ID that the UI can't render as a pretty name.
 */
export function reconcileSelectedModel(): void {
  const s = useModelStore.getState();
  const ids = new Set<string>([
    ...s.availableModels.map((m) => m.id),
    ...s.piModels.map((m) => m.id),
    ...s.localModels.map((m) => m.id),
  ]);
  if (ids.size === 0) return; // registry still loading
  if (ids.has(s.selectedModel)) return;

  const fallback = ids.has(s.defaults.session)
    ? s.defaults.session
    : s.availableModels[0]?.id;
  if (!fallback) return;

  console.info(
    `[model-store] selectedModel "${s.selectedModel}" not in registry — resetting to "${fallback}"`,
  );
  s.setSelectedModel(fallback);
}

/** Extract engine from model ID. 'pi:...' → 'pi', 'local:...' → 'local', otherwise 'claude' */
export function getEngineFromModel(modelId: string): 'claude' | 'pi' | 'local' {
  if (modelId.startsWith('pi:')) return 'pi';
  if (modelId.startsWith('local:')) return 'local';
  return 'claude';
}

/** Strip engine prefix from model ID for backend. 'pi:openrouter/...' → 'openrouter/...', 'local:foo' → 'foo' */
export function getModelIdForBackend(modelId: string): string {
  if (modelId.startsWith('pi:')) return modelId.slice(3);
  if (modelId.startsWith('local:')) return modelId.slice(6);
  return modelId;
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
  if (session.engine === 'local' && !session.modelUsed.startsWith('local:')) {
    return `local:${session.modelUsed}`;
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
 *  - `visibleClaudeModels` / `visiblePiModels` / `visibleLocalModels`: dropdown groups filtered by engine
 *  - `pick(modelId)`: update either the session's modelUsed (+ PATCH backend)
 *     or the global default if no session is active
 */
export function useSessionAwareModel() {
  const availableModels = useModelStore((s) => s.availableModels);
  const piModels = useModelStore((s) => s.piModels);
  const localModels = useModelStore((s) => s.localModels);
  const selectedModel = useModelStore((s) => s.selectedModel);
  const setSelectedModel = useModelStore((s) => s.setSelectedModel);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const updateSessionMeta = useSessionStore((s) => s.updateSessionMeta);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );

  const sessionEngine = activeSession?.engine as 'claude' | 'pi' | 'local' | undefined;

  // Resolve the model to display/send:
  //  1. session's stored modelUsed (authoritative per-session choice)
  //  2. if the active session is Pi but has no modelUsed yet, fall back to
  //     the first registered Pi model (NOT the global default, which is
  //     typically a Claude model — would render the wrong badge/name)
  //  3. otherwise, the global selectedModel (new-session default)
  const effectiveSelected = useMemo(() => {
    const fromSession = modelIdFromSession(activeSession);
    if (fromSession) return fromSession;
    if (sessionEngine === 'pi' && piModels.length > 0) return piModels[0].id;
    if (sessionEngine === 'local' && localModels.length > 0) return localModels[0].id;
    if (sessionEngine === 'claude' && availableModels.length > 0) {
      // Only override global if it's a non-Claude model (engine mismatch guard)
      if (selectedModel.startsWith('pi:') || selectedModel.startsWith('local:')) return availableModels[0].id;
    }
    return selectedModel;
  }, [activeSession, sessionEngine, piModels, localModels, availableModels, selectedModel]);

  // Always show all model groups so the user can switch engines on the fly
  const visibleClaudeModels = availableModels;
  const visiblePiModels = piModels;
  const visibleLocalModels = localModels;

  const pick = (modelId: string) => {
    if (!activeSession) {
      setSelectedModel(modelId);
      return;
    }
    const pickedEngine = getEngineFromModel(modelId);
    const backendModel = getModelIdForBackend(modelId);

    // Build the PATCH payload — always update modelUsed, and switch engine if needed
    const patchBody: Record<string, string> = { modelUsed: backendModel };
    if (sessionEngine && pickedEngine !== sessionEngine) {
      patchBody.engine = pickedEngine;
      updateSessionMeta(activeSession.id, { modelUsed: backendModel, engine: pickedEngine });
    } else {
      updateSessionMeta(activeSession.id, { modelUsed: backendModel });
    }

    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`/api/sessions/${activeSession.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patchBody),
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
    visibleLocalModels,
    pick,
  };
}
