import { useEffect, useState } from 'react';

interface SlideData {
  index: number;
  texts: string[];
  notes?: string;
}

/**
 * PPTX Preview — lightweight slide viewer using JSZip.
 * Extracts text content from each slide XML and renders as card-style slides.
 * No jQuery dependency. Supports Korean/CJK text via native XML parsing.
 */
export function PptxPreview({ filePath }: { filePath: string }) {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [slideImages, setSlideImages] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError('');

        // Fetch binary
        const token = localStorage.getItem('token') || '';
        const res = await fetch(
          `/api/files/serve?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`
        );
        if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();

        if (cancelled) return;

        // Import JSZip (already bundled via docx-preview dep)
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(arrayBuffer);

        if (cancelled) return;

        // Find slide files (ppt/slides/slide1.xml, slide2.xml, ...)
        const slideFiles = Object.keys(zip.files)
          .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
          .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
            const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
            return numA - numB;
          });

        const parsedSlides: SlideData[] = [];
        const images: Record<number, string> = {};

        for (let i = 0; i < slideFiles.length; i++) {
          const xml = await zip.file(slideFiles[i])!.async('string');
          const texts = extractTextsFromXml(xml);
          parsedSlides.push({ index: i, texts });

          // Try to extract slide images from relationships
          const relsPath = slideFiles[i].replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
          const relsFile = zip.file(relsPath);
          if (relsFile) {
            const relsXml = await relsFile.async('string');
            const imageRel = extractFirstImageRel(relsXml);
            if (imageRel) {
              const imagePath = `ppt/slides/${imageRel}`.replace(/\/\.\.\//g, '/').replace('slides/../', '');
              const imageFile = zip.file(imagePath);
              if (imageFile) {
                const blob = await imageFile.async('blob');
                images[i] = URL.createObjectURL(blob);
              }
            }
          }
        }

        if (!cancelled) {
          setSlides(parsedSlides);
          setSlideImages(images);
          setActiveSlide(0);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to parse PPTX');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // Clean up blob URLs
      Object.values(slideImages).forEach(url => URL.revokeObjectURL(url));
    };
  }, [filePath]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading presentation...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        No slides found
      </div>
    );
  }

  const slide = slides[activeSlide];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Navigation bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-850 border-b border-surface-700 shrink-0">
        <button
          onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))}
          disabled={activeSlide === 0}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs text-gray-300 font-medium min-w-[60px] text-center">
          {activeSlide + 1} / {slides.length}
        </span>
        <button
          onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))}
          disabled={activeSlide === slides.length - 1}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-500">PPTX Preview</span>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Slide thumbnails sidebar */}
        <div className="w-24 shrink-0 bg-surface-900 border-r border-surface-700 overflow-y-auto py-2 px-1.5 space-y-1.5">
          {slides.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSlide(i)}
              className={`w-full aspect-[16/10] rounded-md border-2 transition-all text-[8px] text-gray-500 p-1 overflow-hidden flex items-center justify-center ${
                i === activeSlide
                  ? 'border-primary-500 bg-surface-800'
                  : 'border-surface-700 bg-surface-850 hover:border-surface-600'
              }`}
            >
              <span className="truncate">{s.texts[0]?.slice(0, 20) || `Slide ${i + 1}`}</span>
            </button>
          ))}
        </div>

        {/* Active slide */}
        <div className="flex-1 flex items-center justify-center bg-surface-950 p-6 overflow-auto">
          <div className="w-full max-w-4xl aspect-[16/10] bg-white rounded-lg shadow-2xl p-8 flex flex-col overflow-auto"
               style={{ fontFamily: "'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif" }}>
            {slideImages[activeSlide] && (
              <img
                src={slideImages[activeSlide]}
                alt=""
                className="max-w-full max-h-[30%] object-contain mb-4 self-center"
              />
            )}
            {slide.texts.map((text, i) => {
              // First text is likely the title
              if (i === 0 && text.length > 0) {
                return (
                  <h2 key={i} className="text-2xl font-bold text-gray-900 mb-4">
                    {text}
                  </h2>
                );
              }
              if (!text.trim()) return null;
              return (
                <p key={i} className="text-base text-gray-700 mb-2 leading-relaxed">
                  {text}
                </p>
              );
            })}
            {slide.texts.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                (No text content)
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Extract all text runs from OOXML slide XML */
function extractTextsFromXml(xml: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  const texts: string[] = [];

  // Find all <a:p> (paragraph) elements — text paragraphs in PPTX
  const paragraphs = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'p');

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    // Collect all <a:t> (text run) elements within this paragraph
    const runs = para.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't');
    let paraText = '';
    for (let j = 0; j < runs.length; j++) {
      paraText += runs[j].textContent || '';
    }
    if (paraText.trim()) {
      texts.push(paraText);
    }
  }

  return texts;
}

/** Extract first image relationship from slide rels XML */
function extractFirstImageRel(relsXml: string): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(relsXml, 'text/xml');
  const rels = doc.getElementsByTagName('Relationship');
  for (let i = 0; i < rels.length; i++) {
    const type = rels[i].getAttribute('Type') || '';
    if (type.includes('/image')) {
      return rels[i].getAttribute('Target') || null;
    }
  }
  return null;
}
