import React, { useCallback, useRef } from 'react';

interface ResizeHandleProps {
  onResize: (width: number) => void;
  defaultWidth?: number;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 384;

/** Right panel resize handle (measured from right edge of window) */
export function ResizeHandle({ onResize, defaultWidth = DEFAULT_WIDTH }: ResizeHandleProps) {
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - e.clientX));
      onResize(width);
    };

    const handleMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [onResize]);

  const handleDoubleClick = useCallback(() => {
    onResize(defaultWidth);
  }, [onResize, defaultWidth]);

  return (
    <div
      className="w-1.5 cursor-col-resize hover:bg-primary-500/30 active:bg-primary-500/50 transition-colors shrink-0 relative group"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div className="absolute inset-y-0 left-0 w-px bg-surface-800 group-hover:bg-primary-500/50 transition-colors" />
    </div>
  );
}

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 260;

/** Left sidebar resize handle (measured from left edge of window) */
export function SidebarResizeHandle({ onResize, defaultWidth = SIDEBAR_DEFAULT_WIDTH }: ResizeHandleProps) {
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, e.clientX));
      onResize(width);
    };

    const handleMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [onResize]);

  const handleDoubleClick = useCallback(() => {
    onResize(defaultWidth);
  }, [onResize, defaultWidth]);

  return (
    <div
      className="w-1.5 cursor-col-resize hover:bg-primary-500/30 active:bg-primary-500/50 transition-colors shrink-0 relative group"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div className="absolute inset-y-0 right-0 w-px bg-surface-800 group-hover:bg-primary-500/50 transition-colors" />
    </div>
  );
}

export { MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_DEFAULT_WIDTH };
