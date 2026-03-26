import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { useSettingsStore } from '../../stores/settings-store';

const remarkMathOptions = { singleDollarTextMath: false };

interface HelpTopic {
  slug: string;
  title: string;
  icon: string;
  order: number;
}

export function HelpPanel() {
  const isOpen = useSettingsStore((s) => s.helpOpen);
  const setOpen = useSettingsStore((s) => s.setHelpOpen);

  const [topics, setTopics] = useState<HelpTopic[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [mobileTopicOpen, setMobileTopicOpen] = useState(false);

  // Fetch topics list
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/help')
      .then((r) => r.json())
      .then((data: HelpTopic[]) => {
        setTopics(data);
        if (data.length > 0 && !activeSlug) {
          setActiveSlug(data[0].slug);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Fetch content when active topic changes
  useEffect(() => {
    if (!activeSlug || !isOpen) return;
    setLoading(true);
    fetch(`/api/help/${activeSlug}`)
      .then((r) => r.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch(() => {
        setContent('Failed to load content.');
        setLoading(false);
      });
  }, [activeSlug, isOpen]);

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) setOpen(false);
    },
    [isOpen, setOpen],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen) return null;

  const activeTopic = topics.find((t) => t.slug === activeSlug);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative bg-surface-900 border border-surface-700 rounded-xl shadow-2xl w-[calc(100vw-32px)] max-w-5xl h-[85vh] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-800 shrink-0">
          <h2 className="text-[15px] font-bold text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth={2} strokeLinecap="round" />
            </svg>
            Help
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mobile topic selector */}
        <div className="md:hidden border-b border-surface-800 px-4 py-2 shrink-0">
          <button
            onClick={() => setMobileTopicOpen(!mobileTopicOpen)}
            className="w-full flex items-center justify-between text-[13px] text-gray-300 bg-surface-800 rounded-lg px-3 py-2"
          >
            <span>{activeTopic ? `${activeTopic.icon} ${activeTopic.title}` : 'Select topic'}</span>
            <svg className={`w-4 h-4 transition-transform ${mobileTopicOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {mobileTopicOpen && (
            <div className="mt-1 bg-surface-800 rounded-lg border border-surface-700 overflow-hidden">
              {topics.map((t) => (
                <button
                  key={t.slug}
                  onClick={() => {
                    setActiveSlug(t.slug);
                    setMobileTopicOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                    t.slug === activeSlug
                      ? 'bg-primary-500/10 text-primary-400'
                      : 'text-gray-400 hover:bg-surface-700 hover:text-gray-200'
                  }`}
                >
                  {t.icon} {t.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar — desktop only */}
          <nav className="hidden md:flex flex-col w-56 shrink-0 border-r border-surface-800 overflow-y-auto py-2">
            {topics.map((t) => (
              <button
                key={t.slug}
                onClick={() => setActiveSlug(t.slug)}
                className={`flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-left transition-all ${
                  t.slug === activeSlug
                    ? 'bg-primary-500/10 text-primary-400 border-l-2 border-primary-500'
                    : 'text-gray-400 hover:bg-surface-800 hover:text-gray-200 border-l-2 border-transparent'
                }`}
              >
                <span className="text-base leading-none">{t.icon}</span>
                <span className="truncate">{t.title}</span>
              </button>
            ))}
          </nav>

          {/* Right content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 md:px-8 md:py-6">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-surface-600 text-sm">
                Loading...
              </div>
            ) : (
              <div className="prose prose-invert prose-sm max-w-none
                prose-headings:text-gray-100
                prose-h1:text-xl prose-h1:font-bold prose-h1:mb-4
                prose-h2:text-lg prose-h2:font-semibold prose-h2:mt-8 prose-h2:mb-3
                prose-h3:text-base prose-h3:font-semibold prose-h3:mt-6 prose-h3:mb-2
                prose-p:text-gray-300 prose-p:leading-relaxed
                prose-a:text-primary-400 prose-a:no-underline hover:prose-a:underline
                prose-strong:text-gray-200
                prose-code:text-primary-300 prose-code:bg-surface-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                prose-pre:bg-surface-950 prose-pre:border prose-pre:border-surface-700 prose-pre:rounded-lg
                prose-table:border-collapse
                prose-th:bg-surface-800 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-[12px] prose-th:font-semibold prose-th:text-gray-300 prose-th:border prose-th:border-surface-700
                prose-td:px-3 prose-td:py-2 prose-td:text-[12px] prose-td:text-gray-400 prose-td:border prose-td:border-surface-700
                prose-li:text-gray-300
                prose-blockquote:border-l-primary-500 prose-blockquote:bg-primary-500/5 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg
                prose-hr:border-surface-700
              ">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, [remarkMath, remarkMathOptions]]}
                  rehypePlugins={[rehypeHighlight, rehypeKatex]}
                >
                  {content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
