export const RELOAD_ONCE_KEY = 'tower:reload-once';
export const RELOAD_REASON_KEY = 'tower:reload-reason';

export function normalizeVersion(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name} ${error.message}`
    : typeof error === 'string'
      ? error
      : '';

  if (!message) return false;

  return [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'Loading chunk',
    'ChunkLoadError',
    'dynamically imported module',
  ].some((needle) => message.includes(needle));
}

export function reloadOnce(reason: string): boolean {
  try {
    const alreadyReloaded = sessionStorage.getItem(RELOAD_ONCE_KEY) === '1';
    if (alreadyReloaded) return false;
    sessionStorage.setItem(RELOAD_ONCE_KEY, '1');
    sessionStorage.setItem(RELOAD_REASON_KEY, reason);
    window.location.reload();
    return true;
  } catch {
    window.location.reload();
    return true;
  }
}

export function clearReloadOnceFlag() {
  try {
    sessionStorage.removeItem(RELOAD_ONCE_KEY);
    sessionStorage.removeItem(RELOAD_REASON_KEY);
  } catch {
    // ignore
  }
}
