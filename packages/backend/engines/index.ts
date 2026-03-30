/**
 * Engine factory — lazy-loads engines on first use.
 *
 * To add a new engine:  1. Create engines/my-engine.ts implementing Engine
 *                       2. Add a case here
 * To remove an engine:  1. Delete engines/my-engine.ts
 *                       2. Remove the case here
 */

import type { Engine } from './types.js';

const engines = new Map<string, Engine>();

export async function getEngine(name: string): Promise<Engine> {
  const cached = engines.get(name);
  if (cached) return cached;

  let engine: Engine;

  switch (name) {
    case 'claude': {
      const { ClaudeEngine } = await import('./claude-engine.js');
      engine = new ClaudeEngine();
      break;
    }
    case 'pi': {
      const { PiEngine } = await import('./pi-engine.js');
      engine = new PiEngine();
      break;
    }
    case 'local': {
      const { LocalEngine } = await import('./local-engine.js');
      engine = new LocalEngine();
      break;
    }
    default:
      throw new Error(`Unknown engine: ${name}. Available: claude, pi, local`);
  }

  engines.set(name, engine);
  return engine;
}

/** Initialize all enabled engines (call at server startup) */
export async function initEngines(enabledEngines: string[]) {
  for (const name of enabledEngines) {
    const engine = await getEngine(name);
    engine.init?.();
  }
}

/** Shutdown all loaded engines (call at server shutdown) */
export async function shutdownEngines() {
  for (const [, engine] of engines) {
    engine.shutdown?.();
  }
}

/** Total active sessions across all loaded engines */
export function getTotalActiveCount(): number {
  let total = 0;
  for (const [, engine] of engines) {
    total += engine.getActiveCount();
  }
  return total;
}

/** All running session IDs across all loaded engines */
export function getAllRunningSessionIds(): string[] {
  const ids: string[] = [];
  for (const [, engine] of engines) {
    ids.push(...engine.getRunningSessionIds());
  }
  return ids;
}
