import { useState } from 'react';
import { useSessionStore } from '../../stores/session-store';
import type { TaskMeta } from '../../stores/kanban-store';

interface NewTaskModalProps {
  onClose: () => void;
  onCreated: (task: TaskMeta) => void;
}

export function NewTaskModal({ onClose, onCreated }: NewTaskModalProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cwd, setCwd] = useState(activeSession?.cwd || '/home/enterpriseai/workspace');
  const [submitting, setSubmitting] = useState(false);

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
        body: JSON.stringify({ title: title.trim(), description: description.trim(), cwd: cwd.trim() }),
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

          <div>
            <label className="text-xs text-gray-400 mb-1 block">Working Directory</label>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-gray-200 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
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
