import { describe, it, expect } from 'vitest';
import { buildToolGuard, wrapPiTools, resolveSessionProjectRoot } from './project-access.ts';

describe('wrapPiTools security parity', () => {
  it('allows viewer to use read-only finance tools like excel_read', async () => {
    const guard = buildToolGuard({ role: 'viewer' });
    const tool = {
      name: 'excel_read',
      execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    };

    const wrapped = wrapPiTools([tool], guard)[0];
    const result = await wrapped.execute('t1', { path: '/tmp/demo.xlsx' });

    expect(result.content[0].text).toBe('ok');
  });

  it('allows viewer to use read-only builtins like ls and find', async () => {
    const guard = buildToolGuard({ role: 'viewer' });
    const tools = [
      { name: 'ls', execute: async () => ({ content: [{ type: 'text', text: 'ls ok' }] }) },
      { name: 'find', execute: async () => ({ content: [{ type: 'text', text: 'find ok' }] }) },
    ];

    const [lsTool, findTool] = wrapPiTools(tools, guard);
    const lsResult = await lsTool.execute('t-ls', { path: '/tmp' });
    const findResult = await findTool.execute('t-find', { path: '/tmp', pattern: '*.ts' });

    expect(lsResult.content[0].text).toBe('ls ok');
    expect(findResult.content[0].text).toBe('find ok');
  });

  it('allows viewer to use read-only multi-file finance tools like excel_diff', async () => {
    const guard = buildToolGuard({ role: 'viewer' });
    const tool = {
      name: 'excel_diff',
      execute: async () => ({ content: [{ type: 'text', text: 'diff ok' }] }),
    };

    const wrapped = wrapPiTools([tool], guard)[0];
    const result = await wrapped.execute('t-diff', { files: ['/tmp/a.xlsx', '/tmp/b.xlsx'] });

    expect(result.content[0].text).toBe('diff ok');
  });

  it('enforces project path restrictions for excel_read path arguments', async () => {
    const guard = buildToolGuard({
      role: 'member',
      accessiblePaths: ['/home/enterpriseai/workspace/projects/alpha'],
    });
    const tool = {
      name: 'excel_read',
      execute: async () => ({ content: [{ type: 'text', text: 'should not run' }] }),
    };

    const wrapped = wrapPiTools([tool], guard)[0];
    const result = await wrapped.execute('t2', { path: '/etc/passwd' });

    expect(result.content[0].text).toContain('[Access Denied]');
    expect(result.content[0].text).toContain('outside your accessible project folders');
  });
});

// ─── Session-scoped write guard ───────────────────────────────────────────────
// Orthogonal axis to user accessible-paths: regardless of who the user is
// (including admin), writes within a session must stay under that session's
// project root. Regression: 2026-04-18 tower-brain orphan folder incident.
// See workspace/decisions/2026-04-18-session-scoped-write-guard.md

describe('resolveSessionProjectRoot', () => {
  const base = process.env.WORKSPACE_ROOT || `${process.env.HOME || '/tmp'}/workspace`;

  it('returns the project root for cwd inside a project folder', () => {
    expect(resolveSessionProjectRoot(`${base}/projects/okusystem`)).toBe(`${base}/projects/okusystem`);
    expect(resolveSessionProjectRoot(`${base}/projects/okusystem/strategy/notes`)).toBe(`${base}/projects/okusystem`);
  });

  it('returns null for cwd outside workspace/projects/', () => {
    expect(resolveSessionProjectRoot(`${base}/published/demo`)).toBeNull();
    expect(resolveSessionProjectRoot('/tmp/something')).toBeNull();
    expect(resolveSessionProjectRoot(undefined)).toBeNull();
  });

  it('returns null when cwd IS workspace/projects itself (no slug)', () => {
    expect(resolveSessionProjectRoot(`${base}/projects`)).toBeNull();
  });
});

describe('buildToolGuard — session write guard (admin not exempt)', () => {
  const sessionRoot = '/home/enterpriseai/workspace/projects/okusystem';

  it('blocks admin from creating a new workspace/projects/<name>/ folder', () => {
    // Regression: okusystem session created tower-brain/ despite admin role.
    const guard = buildToolGuard({
      role: 'admin',
      sessionProjectRoot: sessionRoot,
    });
    const result = guard('Bash', {
      command: 'mkdir -p /home/enterpriseai/workspace/projects/tower-brain',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain('[Session Boundary]');
      expect(result.message).toContain('okusystem');
    }
  });

  it('blocks admin Write into another project folder', () => {
    const guard = buildToolGuard({
      role: 'admin',
      sessionProjectRoot: sessionRoot,
    });
    const result = guard('Write', {
      file_path: '/home/enterpriseai/workspace/projects/other-project/AGENTS.md',
      content: 'x',
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain('[Session Boundary]');
    }
  });

  it('allows admin Write into the current session project', () => {
    const guard = buildToolGuard({
      role: 'admin',
      sessionProjectRoot: sessionRoot,
    });
    const result = guard('Write', {
      file_path: `${sessionRoot}/strategy/notes.md`,
      content: 'x',
    });
    expect(result.allowed).toBe(true);
  });

  it('allows admin Write into shared workspace/published/', () => {
    const guard = buildToolGuard({
      role: 'admin',
      sessionProjectRoot: sessionRoot,
    });
    const result = guard('Write', {
      file_path: '/home/enterpriseai/workspace/published/sites/demo/index.html',
      content: 'x',
    });
    expect(result.allowed).toBe(true);
  });

  it('allows admin Write into shared workspace/decisions/', () => {
    const guard = buildToolGuard({
      role: 'admin',
      sessionProjectRoot: sessionRoot,
    });
    const result = guard('Write', {
      file_path: '/home/enterpriseai/workspace/decisions/2026-04-18-test.md',
      content: 'x',
    });
    expect(result.allowed).toBe(true);
  });

  it('allows read-only Bash commands even with a session write guard active', () => {
    const guard = buildToolGuard({
      role: 'admin',
      sessionProjectRoot: sessionRoot,
    });
    // Cross-project READ should not trigger the write guard.
    const result = guard('Bash', {
      command: 'ls /home/enterpriseai/workspace/projects/other-project',
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks cross-project Bash mutation (cp into another project)', () => {
    const guard = buildToolGuard({
      role: 'admin',
      sessionProjectRoot: sessionRoot,
    });
    const result = guard('Bash', {
      command: `cp ${sessionRoot}/file.txt /home/enterpriseai/workspace/projects/other-project/file.txt`,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain('[Session Boundary]');
    }
  });

  it('blocks cross-project redirect (> into another project)', () => {
    const guard = buildToolGuard({
      role: 'admin',
      sessionProjectRoot: sessionRoot,
    });
    const result = guard('Bash', {
      command: 'echo hi > /home/enterpriseai/workspace/projects/other-project/hi.txt',
    });
    expect(result.allowed).toBe(false);
  });

  it('applies the same restriction to member role', () => {
    const guard = buildToolGuard({
      role: 'member',
      accessiblePaths: [
        '/home/enterpriseai/workspace/projects/okusystem',
        '/home/enterpriseai/workspace/projects/other-project',
      ],
      sessionProjectRoot: sessionRoot,
    });
    // Even though member is part of other-project, their current session scopes them out.
    const result = guard('Write', {
      file_path: '/home/enterpriseai/workspace/projects/other-project/AGENTS.md',
      content: 'x',
    });
    expect(result.allowed).toBe(false);
  });

  it('skips the guard when no sessionProjectRoot is provided (legacy sessions)', () => {
    // Non-project sessions (personal cwd) should not be affected — guard is opt-in.
    const guard = buildToolGuard({ role: 'admin' });
    const result = guard('Bash', {
      command: 'mkdir -p /home/enterpriseai/workspace/projects/tower-brain',
    });
    expect(result.allowed).toBe(true);
  });
});
