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
      <div className={`h-72 sm:h-80 w-full rounded-2xl overflow-hidden relative border border-slate-800 shadow-xl bg-slate-950 ${className}`}>
        {beforeImage ? (
          <img src={beforeImage} alt={altBefore} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-500 font-mono">
            No photo evidence available
          </div>
        )}
        <div className="absolute bottom-3.5 inset-x-3.5 bg-slate-950/85 text-slate-300 border border-slate-800 text-xs p-3 rounded-xl backdrop-blur-md flex items-center gap-2">
          <Icon name="clock" className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Resolution in progress. Inspection proof photo will appear here when completed.</span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="interactive-before-after"
      className={`relative h-80 sm:h-96 w-full rounded-2xl overflow-hidden select-none border border-slate-700/80 shadow-2xl bg-slate-950 ${className}`}
    >
      {/* AFTER IMAGE (BOTTOM) */}
      <img src={afterImage} alt={altAfter} className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute top-3.5 right-3.5 bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 text-[10px] font-mono px-3 py-1 rounded-full backdrop-blur-md font-bold shadow-lg">
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
        <div className="absolute top-3.5 left-3.5 bg-slate-950/90 text-slate-200 border border-slate-700 text-[10px] font-mono px-3 py-1 rounded-full backdrop-blur-md font-bold shadow-lg">
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
