import React, { useState, useRef, useEffect } from 'react';
import { type ModelOption, useSessionAwareModel } from '../../stores/model-store';

export function ModelSelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const {
    effectiveSelected,
    visibleClaudeModels,
    visiblePiModels,
    pick,
  } = useSessionAwareModel();

  const allVisible = [...visibleClaudeModels, ...visiblePiModels];
  const current =
    allVisible.find((m) => m.id === effectiveSelected) ||
    allVisible[0] ||
    {
      id: effectiveSelected,
      name: effectiveSelected.replace(/^pi:.*\//, '').replace(/-/g, ' '),
      badge: '',
    };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (!current) return null;

  const hasPi = visiblePiModels.length > 0;
  const hasClaude = visibleClaudeModels.length > 0;

  const handlePick = (modelId: string) => {
    pick(modelId);
    setOpen(false);
  };

  const renderModel = (model: ModelOption) => (
    <button
      key={model.id}
      onClick={() => handlePick(model.id)}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
        model.id === effectiveSelected
          ? 'bg-primary-600/15 text-primary-300'
          : 'text-gray-400 hover:bg-surface-800 hover:text-gray-200'
      }`}
    >
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${model.id === effectiveSelected ? 'bg-primary-400' : 'bg-surface-700'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium">{model.name}</div>
      </div>
      {model.badge && (
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
          model.badge === 'OR'
            ? 'text-violet-300 bg-violet-500/20 border border-violet-500/30'
            : model.badge === 'AZ'
            ? 'text-sky-300 bg-sky-500/20 border border-sky-500/30'
            : 'text-purple-300 bg-purple-500/20 border border-purple-500/30'
        }`}>
          {model.badge}
        </span>
      )}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 bg-surface-800/80 border border-surface-700/50 px-2.5 py-1 rounded-md shadow-sm hover:bg-surface-800 hover:text-gray-300 transition-all cursor-pointer"
      >
        <span>{current.name}</span>
        {current.badge && (
          <span className={`text-[9px] font-bold px-1 py-px rounded ${
            current.badge === 'OR'
              ? 'text-violet-300 bg-violet-500/20 border border-violet-500/30'
              : current.badge === 'AZ'
              ? 'text-sky-300 bg-sky-500/20 border border-sky-500/30'
              : 'text-purple-300 bg-purple-500/20 border border-purple-500/30'
          }`}>
            {current.badge}
          </span>
        )}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl shadow-black/40 overflow-hidden z-[100] animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Claude Code group */}
          {hasClaude && hasPi && (
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-surface-500 uppercase tracking-wider">
              Claude Code
            </div>
          )}
          {visibleClaudeModels.map(renderModel)}

          {/* Pi Agent group */}
          {hasPi && (
            <>
              {hasClaude && <div className="border-t border-surface-700/50 mx-2 my-1" />}
              <div className="px-3 pt-1 pb-1 text-[10px] font-semibold text-violet-400/70 uppercase tracking-wider">
                Pi Agent
              </div>
              {visiblePiModels.map(renderModel)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
