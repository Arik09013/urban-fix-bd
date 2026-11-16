import React, { useState } from 'react';
import Icon from './Icon';

export default function InteractiveBeforeAfter({
  beforeImage,
  afterImage,
  altBefore = 'Before report',
  altAfter = 'After resolution',
  className = '',
}) {
  const [sliderPos, setSliderPos] = useState(50);

  if (!afterImage) {
    return (
      <div className={`h-72 sm:h-80 w-full rounded-lg overflow-hidden relative border-2 border-border-black shadow-[4px_4px_0px_var(--shadow-color)] bg-surface ${className}`}>
        {beforeImage ? (
          <img src={beforeImage} alt={altBefore} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-ink-subtle font-mono">
            No photo evidence available
          </div>
        )}
        <div className="absolute bottom-3.5 inset-x-3.5 bg-surface-clean/95 text-ink-primary border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] text-xs p-3 rounded-lg backdrop-blur-md flex items-center gap-2">
          <Icon name="clock" className="w-4 h-4 text-status-warning-amber shrink-0" />
          <span className="font-mono text-xs">Resolution in progress. Inspection proof photo will appear here when completed.</span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="interactive-before-after"
      className={`relative h-80 sm:h-96 w-full rounded-lg overflow-hidden select-none border-2 border-border-black shadow-[4px_4px_0px_var(--shadow-color)] bg-surface ${className}`}
    >
      {/* AFTER IMAGE (BOTTOM) */}
      <img src={afterImage} alt={altAfter} className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute top-3.5 right-3.5 bg-status-live-green text-on-primary-container border-2 border-border-black text-[10px] font-mono px-3 py-1 rounded shadow-[2px_2px_0px_var(--shadow-color)] font-bold">
        AFTER RESOLUTION
      </div>

      {/* BEFORE IMAGE (TOP CLIPPED) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${sliderPos}%` }}
      >
        <img
          src={beforeImage}
          alt={altBefore}
          className="absolute inset-0 w-full h-full object-cover max-w-none"
          style={{ width: '100%', height: '100%' }}
        />
        <div className="absolute top-3.5 left-3.5 bg-surface-container text-ink-primary border-2 border-border-black text-[10px] font-mono px-3 py-1 rounded shadow-[2px_2px_0px_var(--shadow-color)] font-bold">
          BEFORE REPORTED
        </div>
      </div>

      {/* SLIDER DIVIDER LINE & HANDLE */}
      <div
        className="before-after-divider"
        style={{ left: `${sliderPos}%` }}
      >
        <div className="before-after-handle">
          <Icon name="move-horizontal" className="w-4 h-4 text-white stroke-[2.5]" />
        </div>
      </div>

      {/* RANGE INPUT CONTROLLER */}
      <input
        type="range"
        min="0"
        max="100"
        value={sliderPos}
        onChange={(e) => setSliderPos(Number(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-40"
        aria-label="Before after slider scrub"
      />
    </div>
  );
}
