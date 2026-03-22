import React, { useState, useEffect } from 'react';
import { useRoomStore } from '../../stores/room-store';
import { useProjectStore } from '../../stores/project-store';
import { toastError } from '../../utils/toast';

interface CreateRoomModalProps {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
}

export function CreateRoomModal({ open, onClose, defaultProjectId }: CreateRoomModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roomType, setRoomType] = useState<'team' | 'project' | 'dashboard'>('team');
  const [projectId, setProjectId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const projects = useProjectStore((s) => s.projects);

  // Sync defaultProjectId when modal opens
  useEffect(() => {
    if (open) setProjectId(defaultProjectId || '');
  }, [open, defaultProjectId]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;

    setSubmitting(true);
    try {
      const tk = localStorage.getItem('token');
      const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
      if (tk) hdrs['Authorization'] = `Bearer ${tk}`;

      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, roomType, projectId: projectId || undefined }),
      });

      if (res.ok) {
        const room = await res.json();
        if (room?.id) {
          useRoomStore.getState().addRoom(room);
        }
        setName('');
        setDescription('');
        setRoomType('team');
        setProjectId('');
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        toastError(data.error || `Failed to create room (${res.status})`);
      }
    } catch {
      toastError('Failed to create room');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-900 border border-surface-700 rounded-xl shadow-2xl shadow-black/40 w-full max-w-md mx-4">
        <div className="px-5 py-4 border-b border-surface-800">
          <h2 className="text-[15px] font-semibold text-gray-200">Create Room</h2>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-gray-400 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room name"
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-primary-500/50 transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-gray-400 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this room for?"
              rows={3}
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-primary-500/50 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-gray-400 mb-1.5">Type</label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value as 'team' | 'project' | 'dashboard')}
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-gray-200 focus:outline-none focus:border-primary-500/50 transition-colors"
            >
              <option value="team">Team</option>
              <option value="project">Project</option>
              <option value="dashboard">Dashboard</option>
            </select>
          </div>

          {projects.length > 0 && (
            <div>
              <label className="block text-[12px] font-medium text-gray-400 mb-1.5">Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-gray-200 focus:outline-none focus:border-primary-500/50 transition-colors"
              >
                <option value="">None (General)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[13px] text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-[13px] font-semibold text-white transition-colors"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
