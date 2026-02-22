import React from 'react';
import { usePinStore, type Pin } from '../../stores/pin-store';

interface PinListProps {
  onPinClick: (pin: Pin) => void;
  onUnpin: (id: number) => void;
}

const fileTypeIcons: Record<string, string> = {
  markdown: 'text-gray-400',
  html: 'text-orange-300',
  text: 'text-gray-500',
  python: 'text-green-400',
  typescript: 'text-blue-400',
  javascript: 'text-yellow-300',
};

const fileTypeBadge: Record<string, string> = {
  markdown: 'MD',
  html: 'HTML',
  text: 'TXT',
  python: 'PY',
  typescript: 'TS',
  javascript: 'JS',
};

export function PinList({ onPinClick, onUnpin }: PinListProps) {
  const pins = usePinStore((s) => s.pins);

  if (pins.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <div className="text-surface-700 text-2xl mb-2">&#128204;</div>
        <p className="text-[13px] text-surface-700">
          핀이 없습니다
        </p>
        <p className="text-[11px] text-surface-800 mt-1">
          파일 탭에서 파일을 핀하세요
        </p>
      </div>
    );
  }

  return (
    <div className="px-3 space-y-0.5">
      {pins.map((pin) => (
        <div
          key={pin.id}
          className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-800 transition-colors cursor-pointer"
          onClick={() => onPinClick(pin)}
        >
          <svg
            className={`w-4 h-4 shrink-0 ${fileTypeIcons[pin.file_type] || 'text-gray-500'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          <span className="text-xs text-gray-300 truncate flex-1">{pin.title}</span>
          <span className="text-[9px] font-bold text-surface-600 bg-surface-800 px-1.5 py-0.5 rounded">
            {fileTypeBadge[pin.file_type] || pin.file_type.toUpperCase()}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnpin(pin.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-surface-600 hover:text-red-400 transition-all"
            title="핀 해제"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
