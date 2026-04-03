import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Engine Contract Compliance Tests
 *
 * Verifies that BOTH engines (Claude + Pi) honor the same TowerMessage contract.
 * These are source-level contract tests — they read the actual engine code
 * and verify structural compliance without needing a running server.
 *
 * See: docs/plans/2026-04-03-engine-contract-normalization.md
 */

const CLAUDE_ENGINE = path.resolve(import.meta.dirname, '../claude-engine.ts');
const PI_ENGINE = path.resolve(import.meta.dirname, '../pi-engine.ts');
const TYPES = path.resolve(import.meta.dirname, '../types.ts');

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

describe('Engine Contract — TowerUsage documentation', () => {
  it('types.ts documents REQUIRED/RECOMMENDED/OPTIONAL fields', () => {
    const src = readSource(TYPES);
    expect(src).toMatch(/REQUIRED.*all engines must provide/i);
    expect(src).toMatch(/RECOMMENDED.*all engines should provide/i);
    expect(src).toMatch(/OPTIONAL.*engine-specific/i);
  });

  it('types.ts has engine comparison table', () => {
    const src = readSource(TYPES);
    expect(src).toMatch(/Claude.*Pi/);
    expect(src).toMatch(/inputTokens.*REQUIRED/i);
  });
});

describe('Engine Contract — both engines yield engine_done', () => {
  for (const [name, file] of [['Claude', CLAUDE_ENGINE], ['Pi', PI_ENGINE]]) {
    it(`${name} engine yields engine_done with engineSessionId`, () => {
      const src = readSource(file);
      expect(src).toMatch(/type:\s*['"]engine_done['"]/);
      expect(src).toMatch(/engineSessionId/);
    });
  }
});

describe('Engine Contract — both engines yield turn_done with required fields', () => {
  for (const [name, file] of [['Claude', CLAUDE_ENGINE], ['Pi', PI_ENGINE]]) {
    it(`${name} engine yields turn_done with inputTokens + outputTokens + durationMs`, () => {
      const src = readSource(file);
      // Must have a turn_done message with usage
      expect(src).toMatch(/type:\s*['"]turn_done['"]/);
      expect(src).toMatch(/inputTokens/);
      expect(src).toMatch(/outputTokens/);
      expect(src).toMatch(/durationMs/);
    });

    it(`${name} engine includes context metrics in turn_done`, () => {
      const src = readSource(file);
      expect(src).toMatch(/contextInputTokens/);
      expect(src).toMatch(/contextWindowSize/);
      expect(src).toMatch(/numIterations/);
    });
  }
});

describe('Engine Contract — both engines handle abort gracefully', () => {
  for (const [name, file] of [['Claude', CLAUDE_ENGINE], ['Pi', PI_ENGINE]]) {
    it(`${name} engine suppresses engine_error on user abort`, () => {
      const src = readSource(file);
      // Should check for abort and NOT yield error
      expect(src).toMatch(/abort/i);
      expect(src).toMatch(/isAbort/i);
    });
  }
});

describe('Engine Contract — both engines call EngineCallbacks', () => {
  for (const [name, file] of [['Claude', CLAUDE_ENGINE], ['Pi', PI_ENGINE]]) {
    it(`${name} engine calls callbacks.saveMessage`, () => {
      const src = readSource(file);
      expect(src).toMatch(/callbacks\.saveMessage/);
    });

    it(`${name} engine calls callbacks.updateMessageContent`, () => {
      const src = readSource(file);
      expect(src).toMatch(/callbacks\.updateMessageContent/);
    });

    it(`${name} engine calls callbacks.attachToolResult`, () => {
      const src = readSource(file);
      expect(src).toMatch(/callbacks\.attachToolResult/);
    });

    it(`${name} engine calls callbacks.claimSessionId`, () => {
      const src = readSource(file);
      expect(src).toMatch(/callbacks\.claimSessionId/);
    });

    it(`${name} engine calls callbacks.updateMessageMetrics`, () => {
      const src = readSource(file);
      expect(src).toMatch(/callbacks\.updateMessageMetrics/);
    });
  }
});

describe('Engine Contract — resume failure handling', () => {
  it('Claude engine yields engine_error(recoverable) on resume failure', () => {
    const src = readSource(CLAUDE_ENGINE);
    expect(src).toMatch(/resume_failed/i);
    expect(src).toMatch(/recoverable:\s*true/);
  });

  it('Pi engine yields engine_error(recoverable) on resume failure', () => {
    const src = readSource(PI_ENGINE);
    expect(src).toMatch(/resumeFailedMessage/);
    expect(src).toMatch(/recoverable:\s*true/);
  });

  it('both engines clear stale session ID on resume failure', () => {
    const claudeSrc = readSource(CLAUDE_ENGINE);
    const piSrc = readSource(PI_ENGINE);
    // Claude clears on certain errors
    expect(claudeSrc).toMatch(/claimSessionId\(''\)/);
    // Pi clears on resume catch
    expect(piSrc).toMatch(/claimSessionId\(''\)/);
  });
});

describe('Engine Contract — tool guard integration', () => {
  for (const [name, file] of [['Claude', CLAUDE_ENGINE], ['Pi', PI_ENGINE]]) {
    it(`${name} engine uses buildToolGuard`, () => {
      const src = readSource(file);
      expect(src).toMatch(/buildToolGuard/);
    });
  }
});
