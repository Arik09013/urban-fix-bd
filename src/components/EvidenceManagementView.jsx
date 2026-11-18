import React, { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import InteractiveBeforeAfter from './InteractiveBeforeAfter';
import { api } from '../lib/api';

export default function EvidenceManagementView({
  lang = 'en',
  authUser,
  onRefreshData,
  showToast = () => {},
}) {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit Note Modal
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editedNote, setEditedNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Replace / Resubmit Evidence Modal
  const [isReplacingEvidence, setIsReplacingEvidence] = useState(false);
  const [newEvidenceFile, setNewEvidenceFile] = useState(null);
  const [newEvidenceNote, setNewEvidenceNote] = useState('');
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  const fetchEvidenceList = useCallback(async () => {
    setLoading(true);
    try {
      // Use work-history with limit 50 to get authority items with evidence
      const res = await api('/operations/work-history?limit=50');
      const allItems = res.items || [];
      // Items that have evidence or are in progress/rejected
      setComplaints(allItems);
      if (allItems.length > 0 && !selectedComplaint) {
        // default select first item that has evidence or first item
        const firstWithEvidence = allItems.find(
          (c) => c.after_image_url || c.resolution_evidence?.after_image_url || c.evidence_versions?.length > 0
        ) || allItems[0];
        setSelectedComplaint(firstWithEvidence);
      } else if (selectedComplaint) {
        // update selectedComplaint from latest data
        const updated = allItems.find((c) => c.id === selectedComplaint.id);
        if (updated) setSelectedComplaint(updated);
      }
    } catch (err) {
      showToast(err.message || 'Failed to fetch evidence records.');
    } finally {
      setLoading(false);
    }
  }, [selectedComplaint, showToast]);

  useEffect(() => {
    fetchEvidenceList();
  }, [fetchEvidenceList]);

  // Edit note handler
  const handleSaveNote = async () => {
    if (!selectedComplaint || !editedNote.trim()) {
      showToast('Please enter a completion note.');
      return;
    }
    setSavingNote(true);
    try {
      await api(`/complaints/${selectedComplaint.id}/evidence/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completion_note: editedNote.trim() }),
      });
      showToast('✓ Evidence completion note updated successfully.');
      setIsEditingNote(false);
      await fetchEvidenceList();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      showToast(err.message || 'Failed to update note.');
    } finally {
      setSavingNote(false);
    }
  };

  // Replace / Resubmit evidence handler
  const handleReplaceEvidence = async () => {
    if (!selectedComplaint || !newEvidenceFile || !newEvidenceNote.trim()) {
      showToast('Please select an image file and enter completion notes.');
      return;
    }
    setUploadingEvidence(true);
    try {
      const formData = new FormData();
      formData.append('image', newEvidenceFile);
      formData.append('completion_note', newEvidenceNote.trim());

      await api(`/complaints/${selectedComplaint.id}/evidence/upload`, {
        method: 'POST',
        body: formData,
      });

      showToast('✓ New evidence version submitted. Sent for verification.');
      setIsReplacingEvidence(false);
      setNewEvidenceFile(null);
      setNewEvidenceNote('');
      await fetchEvidenceList();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      showToast(err.message || 'Failed to upload replacement evidence.');
    } finally {
      setUploadingEvidence(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
      const d = new Date(dateString);
      return d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(dateString);
    }
  };

  const filteredComplaints = complaints.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.id.toLowerCase().includes(q) ||
      (c.category && c.category.toLowerCase().includes(q)) ||
      (c.title && c.title.toLowerCase().includes(q)) ||
      (c.location && c.location.toLowerCase().includes(q))
    );
  });

  const currentEvidence =
    selectedComplaint?.after_image_url ||
    selectedComplaint?.resolution_evidence?.after_image_url ||
    selectedComplaint?.evidence_versions?.[selectedComplaint?.evidence_versions?.length - 1]?.image_url;

  const currentNote =
    selectedComplaint?.resolution_evidence?.completion_note ||
    selectedComplaint?.completion_description ||
    selectedComplaint?.evidence_versions?.[selectedComplaint?.evidence_versions?.length - 1]?.completion_note;

  const versions = selectedComplaint?.evidence_versions || [];

  return (
    <div data-testid="evidence-management-view" className="space-y-6">
      {/* HEADER */}
      <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-7 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                {lang === 'bn' ? 'প্রমাণ ব্যবস্থাপনা ও সংস্করণ ইতিহাস' : 'Evidence Management & Version Control'}
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {lang === 'bn'
                ? 'জমা দেওয়া কাজের ছবি, বিবরণ এবং সংস্করণ ইতিহাস পর্যালোচনা করুন। ভুল ছবি সংশোধন করুন বা প্রত্যাখ্যাত প্রমাণের নতুন সংস্করণ জমা দিন।'
                : 'Inspect submitted resolution photos, completion notes, and immutable version history. Correct notes or upload revised evidence versions.'}
            </p>
          </div>
          <button
            onClick={fetchEvidenceList}
            disabled={loading}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 self-start sm:self-auto cursor-pointer transition-colors"
          >
            <Icon name="refresh-cw" className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            <span>{lang === 'bn' ? 'রিফ্রেশ' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* MAIN TWO-COLUMN WORKBENCH */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
        {/* LEFT COLUMN: LIST OF COMPLAINTS WITH EVIDENCE */}
        <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="relative">
            <Icon name="search" className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div className="text-[11px] font-mono text-slate-400 uppercase font-bold px-1">
            Tasks ({filteredComplaints.length})
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
            {filteredComplaints.map((item) => {
              const isSelected = selectedComplaint?.id === item.id;
              const hasEv = Boolean(
                item.after_image_url ||
                item.resolution_evidence?.after_image_url ||
                item.evidence_versions?.length > 0
              );

              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedComplaint(item)}
                  className={`w-full text-left p-3 rounded-xl transition-all flex items-start gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
                  }`}
                >
                  <div className="shrink-0 mt-0.5">
                    {hasEv ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block"></span>
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 block"></span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                        {item.id}
                      </span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                        item.status === 'Resolved' || item.admin_verified
                          ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                          : item.status === 'Rejected'
                          ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300 font-medium truncate mt-0.5">
                      {item.category}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {item.location}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: EVIDENCE INSPECTOR & VERSION CONTROL */}
        {selectedComplaint ? (
          <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm space-y-6">
            {/* Top Bar with Status and Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {selectedComplaint.id}
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    {selectedComplaint.category}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                  {selectedComplaint.title || selectedComplaint.description}
                </h3>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                  Location: {selectedComplaint.location}
                </p>
              </div>

              {/* Action Buttons: Edit Note & Replace/Resubmit Evidence */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    setEditedNote(currentNote || '');
                    setIsEditingNote(true);
                  }}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Icon name="file-text" className="w-3.5 h-3.5" />
                  <span>Edit Note</span>
                </button>

                <button
                  onClick={() => {
                    setNewEvidenceFile(null);
                    setNewEvidenceNote('');
                    setIsReplacingEvidence(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Icon name="upload-cloud" className="w-3.5 h-3.5" />
                  <span>
                    {selectedComplaint.status === 'Rejected'
                      ? 'Resubmit Correction'
                      : 'Upload Revised Evidence'}
                  </span>
                </button>
              </div>
            </div>

            {/* Rejection notice if present */}
            {selectedComplaint.rejection_reason && (
              <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800/80 text-xs text-red-800 dark:text-red-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Icon name="alert-triangle" className="w-4 h-4 text-red-600" />
                  <span>Action Required: Admin Rejection Notice</span>
                </div>
                <p className="pl-5 leading-relaxed">{selectedComplaint.rejection_reason}</p>
                <p className="pl-5 text-[11px] text-red-600 dark:text-red-300 italic">
                  Please address the feedback and upload a new evidence version using the button above.
                </p>
              </div>
            )}

            {/* Interactive Before & After Viewer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-mono">
                  Before vs. After Comparison
                </div>
                {versions.length > 0 && (
                  <span className="text-[11px] font-mono font-semibold text-slate-500">
                    Active Version: v{versions.length}
                  </span>
                )}
              </div>
              <InteractiveBeforeAfter
                beforeImage={selectedComplaint.beforeImage || selectedComplaint.image_url}
                afterImage={currentEvidence}
                altBefore="Reported Defect"
                altAfter="Resolution Evidence"
              />
            </div>

            {/* Field Completion Note Callout */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-slate-400 uppercase font-bold">
                  Active Completion Note
                </span>
                <button
                  onClick={() => {
                    setEditedNote(currentNote || '');
                    setIsEditingNote(true);
                  }}
                  className="text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] hover:underline cursor-pointer"
                >
                  Edit
                </button>
              </div>
              <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                {currentNote || 'No completion notes submitted for this task.'}
              </p>
              {selectedComplaint.work_completed_at && (
                <div className="text-[10px] font-mono text-slate-400 pt-1">
                  Completed: {formatDate(selectedComplaint.work_completed_at)}
                </div>
              )}
            </div>

            {/* Evidence Version History List */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-mono">
                  Immutable Evidence Version History ({versions.length})
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  Older versions preserved for audit integrity
                </div>
              </div>

              {versions.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-400 font-mono">
                  No evidence versions uploaded yet. Upload completion photo using the button above.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  {versions.map((ver, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-white dark:bg-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
                    >
                      <div className="flex items-start sm:items-center gap-3">
                        {ver.image_url && (
                          <a
                            href={ver.image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-12 h-12 rounded-lg overflow-hidden border border-slate-200 shrink-0 block"
                          >
                            <img
                              src={ver.image_url}
                              alt={`Evidence version ${ver.version}`}
                              className="w-full h-full object-cover"
                            />
                          </a>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white">
                              Version {ver.version}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                              ver.verification_status === 'verified'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : ver.verification_status === 'rejected'
                                ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                            }`}>
                              {ver.verification_status || 'submitted'}
                            </span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 text-xs mt-1">
                            {ver.completion_note || 'No notes provided.'}
                          </p>
                          {ver.admin_note && (
                            <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                              Feedback: {ver.admin_note}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 text-right shrink-0">
                        <div>{formatDate(ver.uploaded_at)}</div>
                        {ver.uploaded_by && (
                          <div className="text-[10px] text-slate-500">By: {ver.uploaded_by}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-12 text-center text-xs text-slate-400 font-mono shadow-sm">
            Select a task from the left column to view its evidence records and version history.
          </div>
        )}
      </div>

      {/* EDIT NOTE MODAL */}
      {isEditingNote && selectedComplaint && (
        <div
          data-testid="edit-note-modal"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Icon name="file-text" className="w-4 h-4 text-emerald-600" />
                <span>Edit Field Completion Note</span>
              </h3>
              <button
                onClick={() => setIsEditingNote(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Update the field completion description for task <strong>{selectedComplaint.id}</strong>.
              All modifications are timestamped in the audit log.
            </p>

            <textarea
              rows={4}
              value={editedNote}
              onChange={(e) => setEditedNote(e.target.value)}
              placeholder="Describe work performed on site..."
              className="w-full text-xs p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />

            <div className="flex justify-end gap-3 pt-2">
              <button
                disabled={savingNote}
                onClick={() => setIsEditingNote(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={!editedNote.trim() || savingNote}
                onClick={handleSaveNote}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                {savingNote ? (
                  <span>Saving…</span>
                ) : (
                  <>
                    <Icon name="check" className="w-3.5 h-3.5" />
                    <span>Save Note</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REPLACE / RESUBMIT EVIDENCE MODAL */}
      {isReplacingEvidence && selectedComplaint && (
        <div
          data-testid="replace-evidence-modal"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Icon name="upload-cloud" className="w-4 h-4 text-emerald-600" />
                <span>
                  {selectedComplaint.status === 'Rejected'
                    ? 'Resubmit Corrected Evidence'
                    : 'Upload Replacement Evidence'}
                </span>
              </h3>
              <button
                onClick={() => setIsReplacingEvidence(false)}
                className="text-slate-400 hover:text-slate-600 text-2xl font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Uploading a new completion photo creates a new immutable version (v{(versions.length || 0) + 1})
              and moves the status to <strong>Evidence Uploaded</strong> for verification.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-600 dark:text-slate-300 mb-1 uppercase font-bold">
                  New Completion Photograph <span className="text-red-500">*</span>
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewEvidenceFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-500 dark:text-slate-400 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 dark:file:bg-emerald-950/50 file:text-emerald-700 dark:file:text-emerald-300 hover:file:bg-emerald-100 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-600 dark:text-slate-300 mb-1 uppercase font-bold">
                  Completion Notes / Correction Remarks <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={newEvidenceNote}
                  onChange={(e) => setNewEvidenceNote(e.target.value)}
                  placeholder="Detail the corrective actions taken on site..."
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                disabled={uploadingEvidence}
                onClick={() => setIsReplacingEvidence(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={!newEvidenceFile || !newEvidenceNote.trim() || uploadingEvidence}
                onClick={handleReplaceEvidence}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploadingEvidence ? (
                  <span>Uploading & Verifying…</span>
                ) : (
                  <>
                    <Icon name="upload" className="w-3.5 h-3.5" />
                    <span>Upload & Submit for Verification</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
