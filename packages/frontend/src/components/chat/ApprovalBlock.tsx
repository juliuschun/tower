import { useMemo, useState } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import { parseLooseJson } from '../shared/parse-loose-json';
import { BlockFallback } from '../shared/RichContent';

interface ApprovalSpec {
  action: string;
  description: string;
  details?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface Props {
  raw: string;
  fallbackCode: string;
  onDecision?: (action: string, approved: boolean) => void;
}

export default function ApprovalBlock({ raw, fallbackCode, onDecision }: Props) {
  const theme = useSettingsStore((s) => s.theme);
  const isDark = theme === 'dark';
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null);

  const parsed = useMemo(() => {
    const r = parseLooseJson(raw);
    if (!r.ok) return { ok: false as const, error: r.error };
    const spec = r.data as ApprovalSpec;
    if (!spec.action) return { ok: false as const, error: 'Missing "action" field' };
    if (!spec.description) return { ok: false as const, error: 'Missing "description" field' };
    return { ok: true as const, spec };
  }, [raw]);

  if (!parsed.ok) return <BlockFallback raw={fallbackCode} error={parsed.error} />;
  const { spec } = parsed;

  const handleDecision = (approved: boolean) => {
    setDecision(approved ? 'approved' : 'denied');
    onDecision?.(spec.action, approved);
  };

  const isDanger = spec.danger !== false && (
    spec.danger || /delete|remove|drop|destroy|reset|force/i.test(spec.action)
  );

  return (
    <div className={`my-3 rounded-lg border p-3 ${
      isDanger
        ? (isDark ? 'border-red-800/50 bg-red-900/10' : 'border-red-200 bg-red-50')
        : (isDark ? 'border-amber-800/50 bg-amber-900/10' : 'border-amber-200 bg-amber-50')
    }`}>
      <div className="flex items-start gap-2.5">
        {/* Icon */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base ${
          isDanger ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
        }`}>
          {isDanger ? '⚠' : '?'}
        </div>

        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
            {spec.description}
          </div>
          {spec.details && (
            <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {spec.details}
            </div>
          )}
          <div className={`text-[10px] mt-0.5 font-mono ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            action: {spec.action}
          </div>

          {decision ? (
            <div className={`mt-2 text-xs font-medium ${
              decision === 'approved' ? 'text-emerald-400' : 'text-gray-500'
            }`}>
              {decision === 'approved' ? 'Approved' : 'Denied'}
            </div>
          ) : (
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => handleDecision(true)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  isDanger
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-primary-600 hover:bg-primary-500 text-white'
                }`}
              >
                {spec.confirmLabel || 'Approve'}
              </button>
              <button
                onClick={() => handleDecision(false)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  isDark
                    ? 'bg-surface-700 hover:bg-surface-600 text-gray-300'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                }`}
              >
                {spec.cancelLabel || 'Deny'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
