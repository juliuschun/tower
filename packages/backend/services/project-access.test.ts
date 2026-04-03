import { describe, it, expect } from 'vitest';
import { buildToolGuard, wrapPiTools } from './project-access.ts';

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
