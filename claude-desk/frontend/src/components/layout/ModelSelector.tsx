import React, { useState, useRef, useEffect } from 'react';
import { useModelStore } from '../../stores/model-store';

export function ModelSelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { availableModels, selectedModel, connectionType, setSelectedModel } = useModelStore();

  const current = availableModels.find((m) => m.id === selectedModel) || availableModels[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (!current) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 bg-surface-800/80 border border-surface-700/50 px-2.5 py-1 rounded-md shadow-sm hover:bg-surface-800 hover:text-gray-300 transition-all cursor-pointer"
      >
        <span>{current.name}</span>
        {connectionType && (
          <span className="text-[9px] font-bold text-purple-300 bg-purple-500/20 border border-purple-500/30 px-1 py-px rounded">
            {connectionType}
          </span>
        )}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl shadow-black/40 overflow-hidden z-[100] animate-in fade-in slide-in-from-top-1 duration-150">
          {availableModels.map((model) => (
            <button
              key={model.id}
              onClick={() => { setSelectedModel(model.id); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                model.id === selectedModel
                  ? 'bg-primary-600/15 text-primary-300'
                  : 'text-gray-400 hover:bg-surface-800 hover:text-gray-200'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${model.id === selectedModel ? 'bg-primary-400' : 'bg-surface-700'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium">{model.name}</div>
                <div className="text-[10px] text-surface-600 truncate">{model.id}</div>
              </div>
              {model.badge && (
                <span className="text-[9px] font-bold text-purple-300 bg-purple-500/20 border border-purple-500/30 px-1.5 py-0.5 rounded shrink-0">
                  {model.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
