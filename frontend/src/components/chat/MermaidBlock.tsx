import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let initialized = false;
let counter = 0;

function ensureInit() {
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      fontFamily: 'inherit',
    });
    initialized = true;
  }
}

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${counter++}`);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      ensureInit();
      try {
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Mermaid render error');
          // mermaid leaves a broken element in the DOM — clean up
          const broken = document.getElementById('d' + idRef.current);
          broken?.remove();
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <pre className="bg-surface-900/60 border border-surface-700/40 rounded-lg p-4 overflow-x-auto text-sm">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-2 flex justify-center [&_svg]:max-w-full"
    />
  );
}
