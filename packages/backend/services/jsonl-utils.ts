import fs from 'fs';
import path from 'path';
import os from 'os';

/** Build .jsonl file path for a Claude session */
export function buildJsonlPath(cwd: string, claudeSessionId: string, configDir?: string): string {
  const cwdPath = cwd.replace(/\//g, '-');
  const base = configDir || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects', cwdPath, `${claudeSessionId}.jsonl`);
}

/** Read a .jsonl file and check for task completion markers */
export function checkJsonlForCompletion(jsonlPath: string): {
  status: 'complete' | 'failed' | 'running';
  reason?: string;
  stages: string[];
} {
  const stages: string[] = [];
  try {
    const content = fs.readFileSync(jsonlPath, 'utf8');

    const stageMatches = content.matchAll(/\[STAGE:\s*(.+?)\]/g);
    for (const m of stageMatches) {
      if (!stages.includes(m[1])) stages.push(m[1]);
    }

    if (content.includes('[TASK COMPLETE]')) {
      return { status: 'complete', stages };
    }

    const failMatch = content.match(/\[TASK FAILED:\s*(.+?)\]/);
    if (failMatch) {
      return { status: 'failed', reason: failMatch[1], stages };
    }

    return { status: 'running', stages };
  } catch {
    return { status: 'running', stages };
  }
}

/**
 * Find a .jsonl file by claudeSessionId, searching beyond the expected cwd path.
 * The SDK stores .jsonl in ~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl,
 * but the cwd stored in our DB may not match (e.g. project cwd vs workspace root).
 *
 * Search order:
 * 1. Expected path from provided cwd
 * 2. Scan all project directories for the file (UUID is globally unique)
 *
 * Returns the full path if found, null otherwise.
 */
export function findJsonlFile(claudeSessionId: string, cwd?: string, configDir?: string): string | null {
  const fileName = `${claudeSessionId}.jsonl`;
  const base = configDir || path.join(os.homedir(), '.claude');

  // 1. Try expected path first
  if (cwd) {
    const expected = buildJsonlPath(cwd, claudeSessionId, configDir);
    if (fs.existsSync(expected)) return expected;
  }

  // 2. Scan all project directories (within the account's config dir)
  const projectsDir = path.join(base, 'projects');
  try {
    const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const candidate = path.join(projectsDir, dir.name, fileName);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* projects dir doesn't exist */ }

  // 3. If using a custom configDir, also check default ~/.claude/ as fallback
  if (configDir) {
    return findJsonlFile(claudeSessionId, cwd);
  }

  return null;
}

/**
 * Check if a session's .jsonl indicates the SDK response was complete.
 * Unlike task completion markers, this checks for SDK-level result messages
 * that indicate the assistant finished responding.
 */
export function isSessionResponseComplete(jsonlPath: string): boolean {
  try {
    const content = fs.readFileSync(jsonlPath, 'utf8');
    const lines = content.trim().split('\n');

    // Read last few lines (result message is near the end)
    const tail = lines.slice(-10);
    for (const line of tail) {
      try {
        const entry = JSON.parse(line);
        // SDK writes a result message when the turn finishes
        if (entry.type === 'result') return true;
      } catch { /* skip non-JSON lines */ }
    }
    return false;
  } catch {
    return false;
  }
}
