import { useState, useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/session-store';
import type { TaskMeta } from '../../stores/kanban-store';

const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-6', name: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
];

interface NewTaskModalProps {
  onClose: () => void;
  onCreated: (task: TaskMeta) => void;
}

/* ── Combobox: dropdown + free-text ── */
function ComboBox({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setTyping(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // When typing, filter by search term; otherwise show all
  const filtered = typing && search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  // Shorten path for display in suggestions
  const shortPath = (p: string) => {
    const parts = p.split('/');
    if (parts.length <= 3) return p;
    return '.../' + parts.slice(-2).join('/');
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setSearch(e.target.value);
            setTyping(true);
            setOpen(true);
          }}
          onFocus={() => {
            if (options.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-8 text-sm bg-surface-800 border border-surface-700 rounded-lg text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => {
            setTyping(false);
            setSearch('');
            setOpen(!open);
          }}
          className={`absolute right-2 top-1/2 -translate-y-1/2 transition-colors ${
            options.length > 0 ? 'text-gray-500 hover:text-gray-300 cursor-pointer' : 'text-gray-700 cursor-default'
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl max-h-40 overflow-y-auto">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt);
                setTyping(false);
                setSearch('');
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm font-mono hover:bg-surface-700 transition-colors ${
                opt === value ? 'text-blue-400' : 'text-gray-300'
              }`}
              title={opt}
            >
              {shortPath(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Dropdown: styled select ── */
function Dropdown({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => o.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-gray-200 hover:border-surface-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors cursor-pointer"
      >
        <span>{selected?.name || value}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-700 transition-colors flex items-center gap-2 ${
                opt.id === value ? 'text-blue-400 bg-surface-750' : 'text-gray-300'
              }`}
            >
              {opt.id === value && (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                </svg>
              )}
              <span className={opt.id === value ? '' : 'ml-5'}>{opt.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewTaskModal({ onClose, onCreated }: NewTaskModalProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cwd, setCwd] = useState(activeSession?.cwd || '/home/enterpriseai/workspace');
  const [model, setModel] = useState('claude-opus-4-6');
  const [submitting, setSubmitting] = useState(false);
  const [pastCwds, setPastCwds] = useState<string[]>([]);

  // Fetch past CWDs on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch('/api/tasks/meta', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.cwds) {
          // Also include session cwds for richer suggestions
          const sessionCwds = sessions.map((s) => s.cwd).filter(Boolean);
          const all = [...new Set([...data.cwds, ...sessionCwds])].sort();
          setPastCwds(all);
        }
      })
      .catch(() => {});
  }, [sessions]);

  const handleSubmit = async () => {
    if (!title.trim() || !cwd.trim()) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), cwd: cwd.trim(), model }),
      });
      if (res.ok) {
        const task = await res.json();
        onCreated(task);
      }
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-900 border border-surface-700 rounded-xl w-full max-w-md p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-gray-200 mb-4">New Task</h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fix login bug, Add dark mode..."
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed task description for the agent..."
              rows={4}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">Working Directory</label>
              <ComboBox
                value={cwd}
                onChange={setCwd}
                options={pastCwds}
                placeholder="/home/user/project"
              />
            </div>
            <div className="w-40">
              <label className="text-xs text-gray-400 mb-1 block">Model</label>
              <Dropdown
                value={model}
                onChange={setModel}
                options={AVAILABLE_MODELS}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !cwd.trim() || submitting}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {submitting ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
