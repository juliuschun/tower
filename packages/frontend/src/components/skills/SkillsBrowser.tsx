import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../../stores/settings-store';
import type { SkillMeta } from '@tower/shared';

const API = '/api';

interface SkillDetail extends SkillMeta {
  content: string;
}

export function SkillsBrowser() {
  const open = useSettingsStore((s) => s.skillsBrowserOpen);
  const setOpen = useSettingsStore((s) => s.setSkillsBrowserOpen);

  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [form, setForm] = useState({ name: '', description: '', content: '', category: 'general', scope: 'personal' as string });

  const token = localStorage.getItem('token');
  const role = localStorage.getItem('userRole');
  const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) hdrs['Authorization'] = `Bearer ${token}`;

  const loadSkills = useCallback(() => {
    fetch(`${API}/skills`, { headers: hdrs })
      .then(r => r.ok ? r.json() : [])
      .then(setSkills)
      .catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) loadSkills(); }, [open, loadSkills]);

  const loadDetail = async (id: string) => {
    const r = await fetch(`${API}/skills/${id}`, { headers: hdrs });
    if (r.ok) {
      const detail = await r.json();
      setSelected(detail);
      setEditing(false);
    }
  };

  const handleCreate = async () => {
    if (!form.name || !form.content) return;
    const content = form.content.startsWith('---')
      ? form.content
      : `---\nname: ${form.name}\ndescription: ${form.description || form.name}\n---\n\n${form.content}`;
    await fetch(`${API}/skills`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ name: form.name, scope: form.scope, description: form.description, content, category: form.category }),
    });
    setCreating(false);
    setForm({ name: '', description: '', content: '', category: 'general', scope: 'personal' });
    loadSkills();
  };

  const handleUpdate = async () => {
    if (!selected) return;
    await fetch(`${API}/skills/${selected.id}`, {
      method: 'PUT', headers: hdrs,
      body: JSON.stringify({ name: form.name, description: form.description, content: form.content, category: form.category }),
    });
    setEditing(false);
    loadSkills();
    loadDetail(selected.id);
  };

  const handleDelete = async () => {
    if (!selected || !confirm('Delete this skill?')) return;
    await fetch(`${API}/skills/${selected.id}`, { method: 'DELETE', headers: hdrs });
    setSelected(null);
    loadSkills();
  };

  const handleToggle = async () => {
    if (!selected) return;
    if (role === 'admin' && selected.scope === 'company') {
      // Admin toggles global enabled state
      await fetch(`${API}/skills/${selected.id}`, {
        method: 'PUT', headers: hdrs,
        body: JSON.stringify({ enabled: !selected.enabled }),
      });
    } else {
      // User toggles personal preference
      const currentlyActive = selected.userEnabled !== false;
      await fetch(`${API}/skills/${selected.id}/toggle`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ enabled: !currentlyActive }),
      });
    }
    loadSkills();
    loadDetail(selected.id);
  };

  if (!open) return null;

  // Group skills by scope
  const grouped = { personal: [] as SkillMeta[], project: [] as SkillMeta[], company: [] as SkillMeta[] };
  for (const s of skills) {
    const q = search.toLowerCase();
    if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) continue;
    if (s.scope in grouped) grouped[s.scope as keyof typeof grouped].push(s);
  }

  const scopeLabel = { personal: 'My Skills', project: 'Project', company: 'Company' };
  const scopeColor = {
    personal: 'text-blue-400',
    project: 'text-green-400',
    company: 'text-amber-400',
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

      <div className="relative bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="text-[15px] font-bold text-gray-100">Skills</h2>
            <span className="text-[11px] text-gray-500">{skills.length} skills</span>
          </div>
          <button onClick={() => setOpen(false)} className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-surface-800 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 3-column body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left nav */}
          <div className="w-40 border-r border-surface-800 p-3 flex flex-col gap-1 shrink-0">
            <button className="flex items-center gap-2 px-3 py-2 text-[12px] font-medium text-primary-400 bg-primary-600/10 rounded-lg">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Skills
            </button>
            <button className="flex items-center gap-2 px-3 py-2 text-[12px] text-gray-500 hover:text-gray-300 rounded-lg hover:bg-surface-800/50 transition-colors cursor-not-allowed" title="Coming soon">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              MCP
            </button>
            <div className="flex-1" />
            <p className="text-[10px] text-gray-600 px-3 leading-relaxed">
              Skills give Claude specialized expertise as reusable /commands
            </p>
          </div>

          {/* Middle: skill list */}
          <div className="w-56 border-r border-surface-800 flex flex-col shrink-0">
            {/* Search + Add */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-800">
              <div className="flex-1 relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full bg-surface-800/50 border border-surface-700 rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-gray-200 placeholder-gray-600 focus:border-primary-500/50 focus:outline-none" />
              </div>
              <button onClick={() => { setCreating(true); setSelected(null); setEditing(false); setForm({ name: '', description: '', content: '', category: 'general', scope: 'personal' }); }}
                className="p-1.5 text-gray-500 hover:text-primary-400 hover:bg-surface-800 rounded-lg transition-colors" title="New skill">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            {/* Grouped list */}
            <div className="flex-1 overflow-y-auto">
              {(Object.entries(grouped) as [keyof typeof grouped, SkillMeta[]][]).map(([scope, items]) => (
                items.length > 0 && (
                  <div key={scope}>
                    <div className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                      <span className={scopeColor[scope]}>{scopeLabel[scope]}</span>
                      <span className="text-gray-600">{items.length}</span>
                    </div>
                    {items.map(s => (
                      <button key={s.id} onClick={() => { loadDetail(s.id); setCreating(false); }}
                        className={`w-full text-left px-3 py-2 flex items-center gap-2 text-[12px] transition-colors ${
                          selected?.id === s.id ? 'bg-surface-800 text-white' : 'text-gray-300 hover:bg-surface-800/50'
                        }`}>
                        <span className="text-primary-500/60 font-mono">/</span>
                        <span className={`truncate ${(!s.enabled || (s as any).userEnabled === false) ? 'opacity-40 line-through' : ''}`}>{s.name}</span>
                      </button>
                    ))}
                  </div>
                )
              ))}
            </div>
          </div>

          {/* Right: detail panel */}
          <div className="flex-1 overflow-y-auto">
            {creating ? (
              /* Create form */
              <div className="p-5 space-y-4">
                <h3 className="text-[14px] font-bold text-gray-100">New Skill</h3>
                <div className="flex gap-3">
                  <input placeholder="Skill name" value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="flex-1 bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none" />
                  <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
                    className="bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none"
                    disabled={role !== 'admin' && form.scope === 'company'}>
                    <option value="personal">Personal</option>
                    {role === 'admin' && <option value="company">Company</option>}
                    <option value="project">Project</option>
                  </select>
                </div>
                <input placeholder="Short description" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none" />
                <input placeholder="Category (e.g. dev, business)" value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none" />
                <textarea placeholder="Skill instructions (SKILL.md content)" value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  rows={14}
                  className="w-full bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 font-mono focus:border-primary-500/50 focus:outline-none resize-y" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setCreating(false)} className="px-4 py-2 text-[12px] text-gray-400 hover:text-gray-200">Cancel</button>
                  <button onClick={handleCreate} className="px-5 py-2 text-[12px] font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-500 transition-colors">Create</button>
                </div>
              </div>
            ) : selected ? (
              /* Detail view */
              <div className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <h3 className="text-[16px] font-bold text-gray-100 flex items-center gap-2">
                      <span className="text-primary-500/70 font-mono">/</span>
                      {selected.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const isActive = selected.enabled && selected.userEnabled !== false;
                      return (
                        <button onClick={handleToggle} title={isActive ? 'Disable for me' : 'Enable for me'}
                          className={`w-10 h-5 rounded-full transition-colors relative ${isActive ? 'bg-green-600' : 'bg-surface-700'}`}>
                          <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform"
                            style={{ left: isActive ? '22px' : '2px' }} />
                        </button>
                      );
                    })()}
                    <div className="relative group">
                      <button className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-surface-800 rounded-lg transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                      </button>
                      <div className="absolute right-0 top-full mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl py-1 hidden group-hover:block z-10 min-w-[120px]">
                        <button onClick={() => { setEditing(true); setForm({ name: selected.name, description: selected.description, content: selected.content, category: selected.category, scope: selected.scope }); }}
                          className="w-full text-left px-3 py-1.5 text-[12px] text-gray-300 hover:bg-surface-700">Edit</button>
                        {selected.source !== 'bundled' && (
                          <button onClick={handleDelete}
                            className="w-full text-left px-3 py-1.5 text-[12px] text-red-400 hover:bg-surface-700">Delete</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Meta */}
                <div className="flex gap-6 mb-5 text-[11px] text-gray-500">
                  <div>
                    <span className="text-gray-600">Scope</span>
                    <span className={`ml-2 font-medium ${scopeColor[selected.scope as keyof typeof scopeColor] || 'text-gray-400'}`}>{selected.scope}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Category</span>
                    <span className="ml-2 text-gray-300">{selected.category}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Source</span>
                    <span className="ml-2 text-gray-300">{selected.source}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Updated</span>
                    <span className="ml-2 text-gray-300">{new Date(selected.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Description */}
                <div className="mb-5">
                  <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Description</h4>
                  <p className="text-[13px] text-gray-300 leading-relaxed">{selected.description}</p>
                </div>

                {editing ? (
                  /* Edit form */
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="flex-1 bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none" />
                      <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        className="w-32 bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none" />
                    </div>
                    <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      className="w-full bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:border-primary-500/50 focus:outline-none" />
                    <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                      rows={14}
                      className="w-full bg-surface-800/50 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-gray-200 font-mono focus:border-primary-500/50 focus:outline-none resize-y" />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditing(false)} className="px-4 py-2 text-[12px] text-gray-400 hover:text-gray-200">Cancel</button>
                      <button onClick={handleUpdate} className="px-5 py-2 text-[12px] font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-500 transition-colors">Save</button>
                    </div>
                  </div>
                ) : (
                  /* Content preview */
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Content</h4>
                      <div className="flex gap-1">
                        <button onClick={() => setViewMode('preview')}
                          className={`p-1.5 rounded transition-colors ${viewMode === 'preview' ? 'text-primary-400 bg-primary-600/10' : 'text-gray-500 hover:text-gray-300'}`}
                          title="Preview">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button onClick={() => setViewMode('code')}
                          className={`p-1.5 rounded transition-colors ${viewMode === 'code' ? 'text-primary-400 bg-primary-600/10' : 'text-gray-500 hover:text-gray-300'}`}
                          title="Source">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="bg-surface-800/30 border border-surface-700 rounded-lg p-4 max-h-[40vh] overflow-y-auto">
                      {viewMode === 'code' ? (
                        <pre className="text-[12px] text-gray-300 font-mono whitespace-pre-wrap">{selected.content}</pre>
                      ) : (
                        <div className="text-[13px] text-gray-300 leading-relaxed whitespace-pre-wrap">
                          {selected.content.replace(/^---[\s\S]*?---\n*/, '')}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Empty state */
              <div className="flex items-center justify-center h-full text-gray-600">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <p className="text-[13px]">Select a skill to view details</p>
                  <p className="text-[11px] text-gray-700 mt-1">or click + to create a new one</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
