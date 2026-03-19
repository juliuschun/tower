import { useMemo, useState } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { parseLooseJson } from '../shared/parse-loose-json';
import { BlockFallback } from '../shared/RichContent';

interface DiffSpec {
  title?: string;
  mode?: 'split' | 'unified';
  language?: string;
  before: string;
  after: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'same';
  content: string;
  oldNum?: number;
  newNum?: number;
}

interface Props {
  raw: string;
  fallbackCode: string;
}

function computeDiff(before: string, after: string): DiffLine[] {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  // Simple LCS-based diff
  const m = oldLines.length, n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'same', content: oldLines[i - 1], oldNum: i, newNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'add', content: newLines[j - 1], newNum: j });
      j--;
    } else {
      result.push({ type: 'remove', content: oldLines[i - 1], oldNum: i });
      i--;
    }
  }
  result.reverse();
  return result;
}

export default function DiffBlock({ raw, fallbackCode }: Props) {
  const theme = useSettingsStore((s) => s.theme);
  const isDark = theme === 'dark';
  const [mode, setMode] = useState<'split' | 'unified'>('unified');

  const parsed = useMemo(() => {
    const r = parseLooseJson(raw);
    if (!r.ok) return { ok: false as const, error: r.error };
    const spec = r.data as DiffSpec;
    if (spec.before == null || spec.after == null) return { ok: false as const, error: 'Missing "before" and/or "after"' };
    return { ok: true as const, spec };
  }, [raw]);

  const diff = useMemo(() => {
    if (!parsed.ok) return [];
    return computeDiff(parsed.spec.before, parsed.spec.after);
  }, [parsed]);

  if (!parsed.ok) return <BlockFallback raw={fallbackCode} error={parsed.error} />;
  const { spec } = parsed;
  const displayMode = spec.mode || mode;

  const addColor = isDark ? 'bg-emerald-900/30' : 'bg-emerald-50';
  const removeColor = isDark ? 'bg-red-900/30' : 'bg-red-50';
  const addText = isDark ? 'text-emerald-300' : 'text-emerald-700';
  const removeText = isDark ? 'text-red-300' : 'text-red-700';
  const numColor = isDark ? 'text-gray-600' : 'text-gray-400';

  return (
    <div className="my-3 rounded-lg border border-surface-700/40 bg-surface-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-800/40 border-b border-surface-700/30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Diff</span>
          {spec.title && <span className="text-xs text-gray-400">{spec.title}</span>}
          {spec.language && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700/50 text-gray-500">{spec.language}</span>}
        </div>
        <div className="flex gap-0.5 bg-surface-800/60 rounded p-0.5">
          {(['unified', 'split'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                displayMode === m
                  ? (isDark ? 'bg-surface-600 text-gray-200' : 'bg-white text-gray-700 shadow-sm')
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto text-xs font-mono">
        {displayMode === 'unified' ? (
          <table className="w-full">
            <tbody>
              {diff.map((line, i) => (
                <tr key={i} className={line.type === 'add' ? addColor : line.type === 'remove' ? removeColor : ''}>
                  <td className={`px-2 py-0 w-8 text-right select-none ${numColor}`}>
                    {line.oldNum ?? ''}
                  </td>
                  <td className={`px-2 py-0 w-8 text-right select-none ${numColor}`}>
                    {line.newNum ?? ''}
                  </td>
                  <td className="px-1 py-0 w-4 select-none text-center">
                    {line.type === 'add' ? <span className={addText}>+</span>
                     : line.type === 'remove' ? <span className={removeText}>-</span>
                     : <span className="text-gray-700"> </span>}
                  </td>
                  <td className={`px-2 py-0 whitespace-pre ${
                    line.type === 'add' ? addText : line.type === 'remove' ? removeText : (isDark ? 'text-gray-300' : 'text-gray-700')
                  }`}>
                    {line.content}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* Split view */
          <div className="flex">
            <div className="flex-1 border-r border-surface-700/30">
              <table className="w-full">
                <tbody>
                  {diff.filter(l => l.type !== 'add').map((line, i) => (
                    <tr key={i} className={line.type === 'remove' ? removeColor : ''}>
                      <td className={`px-2 py-0 w-8 text-right select-none ${numColor}`}>
                        {line.oldNum ?? ''}
                      </td>
                      <td className={`px-2 py-0 whitespace-pre ${
                        line.type === 'remove' ? removeText : (isDark ? 'text-gray-300' : 'text-gray-700')
                      }`}>
                        {line.content}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex-1">
              <table className="w-full">
                <tbody>
                  {diff.filter(l => l.type !== 'remove').map((line, i) => (
                    <tr key={i} className={line.type === 'add' ? addColor : ''}>
                      <td className={`px-2 py-0 w-8 text-right select-none ${numColor}`}>
                        {line.newNum ?? ''}
                      </td>
                      <td className={`px-2 py-0 whitespace-pre ${
                        line.type === 'add' ? addText : (isDark ? 'text-gray-300' : 'text-gray-700')
                      }`}>
                        {line.content}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
