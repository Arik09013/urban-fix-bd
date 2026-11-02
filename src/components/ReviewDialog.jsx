import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export default function ReviewDialog({ report, onClose, onConfirm, busy }) {
  const [form, setForm] = useState({ category: '', severity: '', department: '', reason: '' });
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (report) setForm({ category: report.category || '', severity: report.severity || '', department: report.department === 'Needs Review' ? '' : report.department || '', reason: '' });
  }, [report]);
  useEffect(() => {
    if (!report) return undefined;
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector('select, input, textarea, button')?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onCloseRef.current();
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); previousFocus?.focus?.(); };
  }, [report, busy]);
  if (!report) return null;
  const valid = form.category && form.severity && form.department.trim() && form.reason.trim().length >= 3;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/70 p-4" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="review-title" aria-describedby="review-description" className="glass-panel w-full max-w-xl rounded-2xl border border-slate-700 p-6">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-xs font-semibold text-sky-400">Human review · {report.id}</div><h2 id="review-title" className="mt-1 text-xl font-bold text-white">Confirm routing decision</h2></div>
          <button onClick={onClose} aria-label="Close review" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><Icon name="x" className="h-4 w-4" /></button>
        </div>
        <p id="review-description" className="mt-3 text-sm leading-6 text-slate-400">Review the evidence and correct the AI recommendation before this case can be assigned.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-300">Category<select value={form.category} onChange={e => setForm({...form, category:e.target.value})} className="glass-input mt-2 w-full rounded-xl p-3 text-sm"><option>Road Infrastructure</option><option>Waste Management</option><option>Water Supply</option><option>Drainage / Sewerage</option><option>Street Lighting</option><option>Public Infrastructure</option><option>Other</option></select></label>
          <label className="text-xs font-semibold text-slate-300">Severity<select value={form.severity} onChange={e => setForm({...form, severity:e.target.value})} className="glass-input mt-2 w-full rounded-xl p-3 text-sm"><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select></label>
          <label className="sm:col-span-2 text-xs font-semibold text-slate-300">Department<input value={form.department} onChange={e => setForm({...form, department:e.target.value})} className="glass-input mt-2 w-full rounded-xl p-3 text-sm" placeholder="Responsible department" /></label>
          <label className="sm:col-span-2 text-xs font-semibold text-slate-300">Decision note<textarea value={form.reason} onChange={e => setForm({...form, reason:e.target.value})} rows="3" className="glass-input mt-2 w-full resize-none rounded-xl p-3 text-sm" placeholder="Explain what was checked or corrected" /></label>
        </div>
        <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300">Cancel</button><button disabled={!valid || busy} onClick={() => onConfirm(form)} className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-40">{busy ? 'Saving…' : 'Confirm review'}</button></div>
      </section>
    </div>
  );
}
