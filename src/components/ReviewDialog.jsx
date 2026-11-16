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
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-4" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="review-title" aria-describedby="review-description" className="w-full max-w-xl bg-surface-clean border-2 border-border-black shadow-[6px_6px_0px_var(--shadow-color)] rounded-lg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-mono font-bold uppercase text-accent-electric-cyan">Human review · {report.id}</div>
            <h2 id="review-title" className="mt-1 text-xl font-headline font-black text-ink-primary">Confirm routing decision</h2>
          </div>
          <button onClick={onClose} aria-label="Close review" className="border-2 border-border-black bg-surface-clean text-ink-primary hover:bg-surface-container shadow-[2px_2px_0px_var(--shadow-color)] p-1.5 transition-colors cursor-pointer">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <p id="review-description" className="mt-3 text-sm leading-6 text-ink-secondary">Review the evidence and correct the AI recommendation before this case can be assigned.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-mono font-bold uppercase text-ink-secondary">Category
            <select value={form.category} onChange={e => setForm({...form, category:e.target.value})} className="glass-input mt-2 w-full rounded-lg p-3 text-sm text-ink-primary bg-surface-clean border-2 border-border-black">
              <option>Road Infrastructure</option>
              <option>Waste Management</option>
              <option>Water Supply</option>
              <option>Drainage / Sewerage</option>
              <option>Street Lighting</option>
              <option>Public Infrastructure</option>
              <option>Other</option>
            </select>
          </label>
          <label className="text-xs font-mono font-bold uppercase text-ink-secondary">Severity
            <select value={form.severity} onChange={e => setForm({...form, severity:e.target.value})} className="glass-input mt-2 w-full rounded-lg p-3 text-sm text-ink-primary bg-surface-clean border-2 border-border-black">
              <option>Critical</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>
          <label className="sm:col-span-2 text-xs font-mono font-bold uppercase text-ink-secondary">Department
            <input value={form.department} onChange={e => setForm({...form, department:e.target.value})} className="glass-input mt-2 w-full rounded-lg p-3 text-sm text-ink-primary bg-surface-clean border-2 border-border-black" placeholder="Responsible department" />
          </label>
          <label className="sm:col-span-2 text-xs font-mono font-bold uppercase text-ink-secondary">Decision note
            <textarea value={form.reason} onChange={e => setForm({...form, reason:e.target.value})} rows="3" className="glass-input mt-2 w-full resize-none rounded-lg p-3 text-sm text-ink-primary bg-surface-clean border-2 border-border-black" placeholder="Explain what was checked or corrected" />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border-2 border-border-black bg-surface-clean px-4 py-2.5 text-sm font-mono font-bold text-ink-primary hover:bg-surface-container shadow-[2px_2px_0px_var(--shadow-color)] transition-all cursor-pointer">
            Cancel
          </button>
          <button disabled={!valid || busy} onClick={() => onConfirm(form)} className="rounded-lg bg-primary-container text-on-primary-container border-2 border-border-black px-5 py-2.5 text-sm font-mono font-bold uppercase shadow-[3px_3px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-40 cursor-pointer">
            {busy ? 'Saving…' : 'Confirm review'}
          </button>
        </div>
      </section>
    </div>
  );
}
