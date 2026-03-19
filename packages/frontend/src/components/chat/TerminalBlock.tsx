import { useMemo, useState } from 'react';
import { parseLooseJson } from '../shared/parse-loose-json';
import { BlockFallback } from '../shared/RichContent';

interface TerminalCommand {
  cmd: string;
  output?: string;
  status?: 'success' | 'error' | 'running';
}

interface TerminalSpec {
  title?: string;
  commands: TerminalCommand[];
}

interface Props {
  raw: string;
  fallbackCode: string;
}

export default function TerminalBlock({ raw, fallbackCode }: Props) {
  const [copied, setCopied] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const parsed = useMemo(() => {
    const r = parseLooseJson(raw);
    if (!r.ok) return { ok: false as const, error: r.error };
    const spec = r.data as TerminalSpec;
    if (!spec.commands || !Array.isArray(spec.commands)) return { ok: false as const, error: 'Missing "commands" array' };
    return { ok: true as const, spec };
  }, [raw]);

  if (!parsed.ok) return <BlockFallback raw={fallbackCode} error={parsed.error} />;
  const { spec } = parsed;

  const copyCmd = async (cmd: string, idx: number) => {
    await navigator.clipboard.writeText(cmd);
    setCopied(idx);
    setTimeout(() => setCopied(null), 1500);
  };

  const toggleCollapse = (idx: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const statusColor = (s?: string) => {
    if (s === 'success') return 'text-emerald-400';
    if (s === 'error') return 'text-red-400';
    if (s === 'running') return 'text-yellow-400 animate-pulse';
    return 'text-gray-400';
  };

  return (
    <div className="my-3 rounded-lg border border-surface-700/40 bg-[#1a1b26] overflow-hidden font-mono text-xs">
      {/* Title bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#16161e] border-b border-surface-700/30">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
        </div>
        <span className="text-[10px] text-gray-600 ml-2">{spec.title || 'Terminal'}</span>
      </div>

      <div className="p-2 space-y-1">
        {spec.commands.map((entry, i) => {
          const isCollapsed = collapsed.has(i);
          return (
            <div key={i}>
              {/* Command line */}
              <div className="flex items-center group">
                <span className="text-emerald-500 mr-1.5 select-none">$</span>
                <span
                  className="text-gray-200 cursor-pointer hover:text-white flex-1"
                  onClick={() => copyCmd(entry.cmd, i)}
                  title="Click to copy"
                >
                  {entry.cmd}
                </span>
                {entry.status && (
                  <span className={`ml-2 text-[10px] ${statusColor(entry.status)}`}>
                    {entry.status === 'success' ? '✓' : entry.status === 'error' ? '✗' : '⟳'}
                  </span>
                )}
                {copied === i && (
                  <span className="ml-1 text-[9px] text-emerald-400">copied</span>
                )}
              </div>
              {/* Output */}
              {entry.output && (
                <div>
                  <button
                    onClick={() => toggleCollapse(i)}
                    className="text-[9px] text-gray-600 hover:text-gray-400 select-none mb-0.5"
                  >
                    {isCollapsed ? '▸ show output' : '▾ hide output'}
                  </button>
                  {!isCollapsed && (
                    <pre className={`whitespace-pre-wrap pl-4 ${
                      entry.status === 'error' ? 'text-red-300/80' : 'text-gray-500'
                    }`}>
                      {entry.output}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
