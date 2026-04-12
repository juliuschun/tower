/**
 * useAppUpdateCoordinator
 *
 * The single React entry-point for "should we apply an update / reload?".
 *
 * Why this exists:
 *  - Previously, App.tsx had ~6 inline pieces (selectors, refs, callbacks,
 *    effects) all related to update detection and reload-safety. The
 *    declaration order broke once and caused a TDZ ReferenceError that
 *    crashed the whole app on first render.
 *  - Centralizing the logic here means: one place to read, one place to
 *    test, and helper functions are kept pure in `utils/update-coordinator`.
 *
 * Responsibilities:
 *  - Wire up the service worker `registerSW()` lifecycle.
 *  - Mirror the relevant slices of settings-store and chat-store as a
 *    plain `ReloadSafetySnapshot`.
 *  - Auto-apply a previously-deferred update the moment the user becomes idle.
 *  - Expose action callbacks (`requestReload`, `deferReload`, `cancelDefer`)
 *    that App.tsx and UpdateBanner can call without knowing the details.
 *  - Expose `evaluateConfigPayload(data)` so App.tsx's existing /api/config
 *    fetch effect can hand off the build comparison without growing more
 *    inline logic.
 *
 * See: docs/arch_plan_0412_update_reload_coordinator.md
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useSettingsStore } from '../stores/settings-store';
import { useChatStore } from '../stores/chat-store';
import { normalizeVersion, reloadOnce } from '../utils/app-version';
import {
  shouldAutoApplyDeferredUpdate,
  evaluateBuildIdChange,
  type ReloadSafetySnapshot,
  type BuildIdEvaluation,
} from '../utils/update-coordinator';

export interface UpdateCoordinator {
  /** True iff the settings-store says a new version is ready to apply. */
  updateAvailable: boolean;
  /** True iff the user has explicitly chosen "apply when current turn ends". */
  deferredUpdateRequested: boolean;
  /** True iff the user is in the middle of something we shouldn't interrupt. */
  isBusyForReload: boolean;

  /**
   * Apply the update right now.
   *
   * Prefers the service worker `updateServiceWorker(true)` path if available
   * (which swaps the SW and reloads). Falls back to the reload-once guard,
   * and ultimately to a plain `window.location.reload()`.
   */
  requestReload: () => void;

  /** Mark the update for "apply when busy → idle". */
  deferReload: () => void;

  /** User changed their mind: cancel the deferred apply. */
  cancelDefer: () => void;

  /**
   * Hand-off from App.tsx's /api/config fetch effect.
   *
   * App still owns the fetch (because the same response also drives pins,
   * models, server config, etc.). All this hook needs is to inspect the
   * fresh payload and decide what to do about the buildId — which is the
   * piece that used to be inline in App.tsx and which we want gone.
   *
   * Returns the evaluation result so the caller can decide whether to
   * short-circuit (e.g. when an auto-reload was triggered).
   */
  evaluateConfigPayload: (data: { buildId?: string; version?: string } | null | undefined) => BuildIdEvaluation | null;
}

/**
 * Read a fresh ReloadSafetySnapshot from the live chat-store.
 *
 * Kept as a free function (not a hook) so the same logic is reused both
 * by the live React selector and by the imperative path inside
 * `evaluateConfigPayload`, which runs from a fetch `.then()` callback
 * outside of React's render cycle.
 */
function readReloadSafetySnapshot(): ReloadSafetySnapshot {
  const chat = useChatStore.getState();
  const queuedMessageCount = Object.values(chat.messageQueue).reduce(
    (sum, q) => sum + (q?.length ?? 0),
    0,
  );
  return {
    isStreaming: chat.isStreaming,
    hasPendingQuestion: !!chat.pendingQuestion,
    queuedMessageCount,
  };
}

export function useAppUpdateCoordinator(): UpdateCoordinator {
  // --- store selectors -----------------------------------------------------
  const updateAvailable = useSettingsStore((s) => s.updateAvailable);
  const deferredUpdateRequested = useSettingsStore((s) => s.deferredUpdateRequested);

  // Re-render whenever the busy-relevant chat slices change. We compute the
  // boolean inline (rather than via the snapshot helper) so zustand's shallow
  // equality short-circuits when these primitives don't change.
  const isBusyForReload = useChatStore(
    (s) => s.isStreaming || !!s.pendingQuestion || Object.values(s.messageQueue).some((q) => q.length > 0),
  );

  // --- service worker registration ----------------------------------------
  // The ref holds the `updateServiceWorker` function returned by registerSW.
  // It's only set once, in the mount effect below.
  const swUpdateRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        // The new SW is installed and waiting. Mirror that into the store
        // so the UpdateBanner appears (or, if user is idle, the deferred-
        // apply effect below will fire it immediately).
        const buildId = useSettingsStore.getState().serverConfig?.buildId || null;
        useSettingsStore.getState().setUpdateAvailable(true, buildId);
      },
      onOfflineReady() {
        // OfflineBanner already covers the connectivity story; nothing to do.
      },
    });
    swUpdateRef.current = updateSW;
  }, []);

  // --- action callbacks ---------------------------------------------------
  const requestReload = useCallback(() => {
    if (swUpdateRef.current) {
      void swUpdateRef.current(true);
      return;
    }
    if (updateAvailable) {
      reloadOnce('manual-update-banner');
      return;
    }
    window.location.reload();
  }, [updateAvailable]);

  const deferReload = useCallback(() => {
    useSettingsStore.getState().setDeferredUpdateRequested(true);
  }, []);

  const cancelDefer = useCallback(() => {
    useSettingsStore.getState().setDeferredUpdateRequested(false);
  }, []);

  // --- deferred-update auto-apply ----------------------------------------
  //
  // The instant the user transitions out of "busy" while a deferred apply is
  // queued, fire it. This is the whole point of the "턴 끝나면 업데이트"
  // affordance.
  useEffect(() => {
    const ready = shouldAutoApplyDeferredUpdate(
      { updateAvailable, deferredUpdateRequested },
      readReloadSafetySnapshot(),
    );
    if (!ready) return;
    requestReload();
  }, [updateAvailable, deferredUpdateRequested, isBusyForReload, requestReload]);

  // --- /api/config payload hand-off --------------------------------------
  const evaluateConfigPayload = useCallback<UpdateCoordinator['evaluateConfigPayload']>((data) => {
    if (!data) return null;

    const nextBuildId = normalizeVersion(data.buildId || data.version);
    const settings = useSettingsStore.getState();
    const currentBuildId = normalizeVersion(
      settings.serverConfig?.buildId || settings.serverConfig?.version,
    );
    const evaluation = evaluateBuildIdChange(currentBuildId, nextBuildId, readReloadSafetySnapshot());

    switch (evaluation.kind) {
      case 'changed-safe':
        // Safe to swap immediately. The reload-once guard prevents loops.
        reloadOnce('server-build-changed');
        return evaluation;
      case 'changed-busy':
        // Show the banner so the user can choose immediate vs deferred.
        settings.setUpdateAvailable(true, evaluation.latestBuildId);
        return evaluation;
      case 'first-seen':
      case 'no-change':
        // Track latestBuildId but don't surface anything.
        settings.setUpdateAvailable(false, evaluation.latestBuildId);
        return evaluation;
    }
  }, []);

  // --- public surface -----------------------------------------------------
  return useMemo(
    () => ({
      updateAvailable,
      deferredUpdateRequested,
      isBusyForReload,
      requestReload,
      deferReload,
      cancelDefer,
      evaluateConfigPayload,
    }),
    [updateAvailable, deferredUpdateRequested, isBusyForReload, requestReload, deferReload, cancelDefer, evaluateConfigPayload],
  );
}
