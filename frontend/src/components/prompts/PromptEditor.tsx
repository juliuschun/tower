import React, { useState, useEffect, useRef } from 'react';

interface PromptEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (title: string, content: string) => void;
  initial?: { title: string; content: string };
}

export function PromptEditor({ open, onClose, onSave, initial }: PromptEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle(initial?.title || '');
      setContent(initial?.content || '');
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open, initial]);

  if (!open) return null;

  const handleSave = () => {
    const t = title.trim();
    if (!t) return;
    onSave(t, content);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-surface-900 border border-surface-700 rounded-xl shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-gray-200 mb-4">
          {initial ? 'Edit Prompt' : 'New Prompt'}
        </h3>

        <input
          ref={titleRef}
          type="text"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-gray-200 px-3 py-2 mb-3 outline-none focus:border-primary-500/50 transition-colors"
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        />

        <textarea
          placeholder="Prompt content..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          className="w-full bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-gray-200 px-3 py-2 mb-4 outline-none focus:border-primary-500/50 resize-none transition-colors"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[12px] text-gray-400 hover:text-gray-200 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="px-4 py-1.5 text-[12px] bg-primary-600 hover:bg-primary-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-md font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
