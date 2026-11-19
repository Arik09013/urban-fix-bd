import React, { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import InteractiveBeforeAfter from './InteractiveBeforeAfter';
import { api } from '../lib/api';

export const formatLocation = (loc) => {
  if (!loc) return 'Location pending';
  if (typeof loc === 'string') {
    const trimmed = loc.trim();
    return trimmed || 'Location pending';
  }
  if (typeof loc === 'object') {
    if (typeof loc.area === 'string' && loc.area.trim()) {
      return loc.area.trim();
    }
    if (typeof loc.address === 'string' && loc.address.trim()) {
      return loc.address.trim();
    }
    if (typeof loc.name === 'string' && loc.name.trim()) {
      return loc.name.trim();
    }

    const lat = loc.latitude !== undefined ? loc.latitude : loc.lat;
    const lng = loc.longitude !== undefined ? loc.longitude : loc.lng;

    if (lat !== undefined && lng !== undefined && lat !== null && lng !== null) {
      const numLat = Number(lat);
      const numLng = Number(lng);
      if (Number.isFinite(numLat) && Number.isFinite(numLng)) {
        return `${numLat}, ${numLng}`;
      }
    }

    return 'Location pending';
  }
  return String(loc);
};

export default function AdminVerificationView({
  lang = 'en',
  authUser,
  onSelectComplaint,
  onRefreshData,
  showToast = () => {},
}) {
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState({
    pending_count: 0,
    approved_count: 0,
    rejected_count: 0,
  });
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Selected item for review/verification
  const [reviewItem, setReviewItem] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Rejection modal state
  const [rejectingItem, setRejectingItem] = useState(null);
  const [rejectionNote, setRejectionNote] = useState('');

  // Approval modal state (optional note)
  const [approvingItem, setApprovingItem] = useState(null);
  const [approvalNote, setApprovalNote] = useState('');

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        page: String(page),
        limit: '10',
      });
      const res = await api(`/operations/verification-queue?${params.toString()}`);
      const rawItems = res.items || [];
      const normalizedItems = rawItems.map((item) => ({
        ...item,
        id: item.complaint_id || item.id,
        location: formatLocation(item.location),
      }));
      setQueue(normalizedItems);
      setTotalPages(res.total_pages || 1);
      setTotalCount(res.total || 0);
      if (res.stats) {
        setStats(res.stats);
      }
    } catch (err) {
      showToast(err.message || 'Failed to load verification queue.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const handleApprove = async () => {
    if (!approvingItem) return;
    setActionLoading(true);
    try {
      await api(`/operations/verify/${approvingItem.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          note: approvalNote.trim() || undefined,
        }),
      });
      showToast(`✓ Incident ${approvingItem.id} approved and marked Verified & Resolved.`);
      setApprovingItem(null);
      setApprovalNote('');
      setReviewItem(null);
      await fetchQueue();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      showToast(err.message || 'Failed to approve submission.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectingItem) return;
    if (!rejectionNote.trim()) {
      showToast('A mandatory rejection reason is required to reject submitted work.');
      return;
    }
    setActionLoading(true);
    try {
      await api(`/operations/verify/${rejectingItem.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          note: rejectionNote.trim(),
        }),
      });
      showToast(`⚠ Incident ${rejectingItem.id} rejected. Sent back for authority correction.`);
      setRejectingItem(null);
      setRejectionNote('');
      setReviewItem(null);
      await fetchQueue();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      showToast(err.message || 'Failed to reject submission.');
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
      const d = new Date(dateString);
      return d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(dateString);
    }
  };

  return (
    <div data-testid="admin-verification-queue" className="space-y-6">
      {/* HEADER SECTION */}
      <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-7 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                {lang === 'bn' ? 'অ্যাডমিন প্রমাণ যাচাইকরণ কিউ' : 'Admin Evidence Verification Queue'}
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {lang === 'bn'
                ? 'কর্তৃপক্ষের জমা দেওয়া রেজোলিউশন প্রমাণ পরীক্ষা করুন। অনুমোদিত হলে তা জনসাধারণের কাছে দৃশ্যমান হবে, অন্যথায় সংশোধনের নির্দেশ দিন।'
                : 'Inspect submitted municipal resolution evidence before public verification. Approve to finalize closure or reject with required corrections.'}
            </p>
          </div>
          <button
            onClick={fetchQueue}
            disabled={loading}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 self-start sm:self-auto cursor-pointer transition-colors"
          >
            <Icon name="refresh-cw" className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-600' : ''}`} />
            <span>{lang === 'bn' ? 'রিফ্রেশ কিউ' : 'Refresh Queue'}</span>
          </button>
        </div>

        {/* STATS TILES */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <button
            onClick={() => { setStatusFilter('pending'); setPage(1); }}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              statusFilter === 'pending'
                ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-400 dark:border-sky-700 shadow-xs'
                : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase font-bold text-sky-700 dark:text-sky-300">
                {lang === 'bn' ? 'যাচাই অপেক্ষমাণ' : 'Pending Verification'}
              </span>
              <Icon name="clock" className="w-4 h-4 text-sky-600" />
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">
              {stats.pending_count}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Requires administrative review
            </div>
          </button>

          <button
            onClick={() => { setStatusFilter('approved'); setPage(1); }}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              statusFilter === 'approved'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-700 shadow-xs'
                : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase font-bold text-emerald-700 dark:text-emerald-300">
                {lang === 'bn' ? 'অনুমোদিত' : 'Approved Work'}
              </span>
              <Icon name="check-circle-2" className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">
              {stats.approved_count}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Verified and published to public
            </div>
          </button>

          <button
            onClick={() => { setStatusFilter('rejected'); setPage(1); }}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              statusFilter === 'rejected'
                ? 'bg-red-50 dark:bg-red-950/40 border-red-400 dark:border-red-700 shadow-xs'
                : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase font-bold text-red-700 dark:text-red-300">
                {lang === 'bn' ? 'প্রত্যাখ্যাত / সংশোধন' : 'Rejected / Correction'}
              </span>
              <Icon name="alert-triangle" className="w-4 h-4 text-red-600" />
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">
              {stats.rejected_count}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Returned to authority with feedback
            </div>
          </button>
        </div>
      </div>

      {/* QUEUE LIST */}
      <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/60 dark:bg-slate-900/40">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 uppercase">
              {statusFilter === 'pending'
                ? `Pending Items (${totalCount})`
                : statusFilter === 'approved'
                ? `Approved Items (${totalCount})`
                : statusFilter === 'rejected'
                ? `Rejected Items (${totalCount})`
                : `All Items (${totalCount})`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setStatusFilter('all'); setPage(1); }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Show All
            </button>
            <span className="text-xs font-mono text-slate-400">Page {page} of {totalPages}</span>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400 font-mono">
            <Icon name="refresh-cw" className="w-5 h-5 mx-auto mb-2 animate-spin text-sky-600" />
            Loading verification queue…
          </div>
        ) : queue.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400 font-mono">
            No submissions in the queue for the selected filter.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {queue.map((item) => {
              const afterImg =
                item.after_image_url ||
                item.resolution_evidence?.after_image_url ||
                item.evidence_versions?.[item.evidence_versions.length - 1]?.image_url;
              const beforeImg = item.beforeImage || item.image_url;
              const note =
                item.resolution_evidence?.completion_note ||
                item.completion_description ||
                item.evidence_versions?.[item.evidence_versions.length - 1]?.completion_note;
              const versionNum = item.evidence_versions?.length || 1;

              return (
                <div
                  key={item.id}
                  className="p-6 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors space-y-4"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-sky-600 dark:text-sky-400 text-xs">
                          {item.id}
                        </span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {item.category}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          v{versionNum}
                        </span>
                        {item.status === 'Resolved' || item.admin_verified ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200">
                            Approved & Verified
                          </span>
                        ) : item.status === 'Rejected' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200">
                            Rejected (Correction Required)
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-200">
                            Pending Verification
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-1">
                        {item.title || item.description}
                      </p>
                      <div className="text-[11px] font-mono text-slate-400 mt-1 flex flex-wrap items-center gap-3">
                        <span>Loc: {formatLocation(item.location)}</span>
                        {item.assigned_authority?.authority_name && (
                          <span>Dept: {item.assigned_authority.authority_name}</span>
                        )}
                        <span>Submitted: {formatDate(item.work_completed_at || item.created_at)}</span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        onClick={() => setReviewItem(item)}
                        className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Compare Visuals
                      </button>

                      {item.status !== 'Resolved' && (
                        <button
                          onClick={() => setApprovingItem(item)}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Icon name="check" className="w-3.5 h-3.5" />
                          <span>Approve Work</span>
                        </button>
                      )}

                      {item.status !== 'Rejected' && (
                        <button
                          onClick={() => {
                            setRejectingItem(item);
                            setRejectionNote('');
                          }}
                          className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Icon name="x" className="w-3.5 h-3.5" />
                          <span>Reject with Notes</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Summary preview bar */}
                  <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      {beforeImg && (
                        <img
                          src={beforeImg}
                          alt="Before"
                          className="w-16 h-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                        />
                      )}
                      {afterImg && (
                        <img
                          src={afterImg}
                          alt="After"
                          className="w-16 h-16 rounded-lg object-cover border border-emerald-300 dark:border-emerald-700"
                        />
                      )}
                    </div>
                    <div className="text-xs space-y-1">
                      <div className="font-mono text-[10px] text-slate-400 uppercase font-bold">
                        Authority Completion Note
                      </div>
                      <p className="text-slate-800 dark:text-slate-200 italic">
                        "{note || 'No notes provided by authority.'}"
                      </p>
                      {item.rejection_reason && (
                        <div className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                          Active Rejection Note: {item.rejection_reason}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* PAGINATION */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/60 dark:bg-slate-900/40">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Previous
            </button>
            <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
              Page <span className="font-bold">{page}</span> of {totalPages}
            </div>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* VISUAL COMPARISON MODAL */}
      {reviewItem && (
        <div
          data-testid="verification-review-modal"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl max-w-3xl w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-4">
              <div>
                <div className="text-xs font-mono text-sky-600 dark:text-sky-400 font-bold">
                  EVIDENCE VERIFICATION AUDIT · {reviewItem.id}
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                  {reviewItem.category} — {reviewItem.title || reviewItem.description}
                </h3>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                  {formatLocation(reviewItem.location)}
                </p>
              </div>
              <button
                onClick={() => setReviewItem(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-2xl font-bold px-2 py-1 cursor-pointer"
              >
                ×
              </button>
            </div>

            {/* Interactive Before & After */}
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-mono">
                Interactive Before & After Comparison
              </div>
              <InteractiveBeforeAfter
                beforeImage={reviewItem.beforeImage || reviewItem.image_url}
                afterImage={
                  reviewItem.after_image_url ||
                  reviewItem.resolution_evidence?.after_image_url ||
                  reviewItem.evidence_versions?.[reviewItem.evidence_versions.length - 1]?.image_url
                }
                altBefore="Reported Defect"
                altAfter="Authority Completed Resolution"
              />
            </div>

            {/* Field Note */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
              <div className="font-mono text-[10px] text-slate-400 uppercase font-bold">
                Authority Field Notes
              </div>
              <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                {reviewItem.resolution_evidence?.completion_note ||
                  reviewItem.completion_description ||
                  'No field completion notes supplied.'}
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setReviewItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Close
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const item = reviewItem;
                    setReviewItem(null);
                    setRejectingItem(item);
                    setRejectionNote('');
                  }}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                >
                  Reject Work
                </button>
                <button
                  onClick={() => {
                    const item = reviewItem;
                    setReviewItem(null);
                    setApprovingItem(item);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                >
                  Approve Work
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* APPROVE CONFIRMATION MODAL */}
      {approvingItem && (
        <div
          data-testid="approve-confirmation-modal"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 shrink-0">
                <Icon name="check-circle-2" className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Approve Municipal Resolution
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Incident ID: {approvingItem.id}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Approving this work will mark the incident status as <strong>Verified / Resolved</strong>,
              validate the authority evidence, and publish the verified completion photo to the public tracking portal.
            </p>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Admin Note / Audit Remarks (Optional)
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Inspected site photograph; pothole properly filled and paved to code."
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                className="w-full text-xs p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                disabled={actionLoading}
                onClick={() => setApprovingItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={actionLoading}
                onClick={handleApprove}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                {actionLoading ? (
                  <span>Approving…</span>
                ) : (
                  <>
                    <Icon name="check" className="w-3.5 h-3.5" />
                    <span>Confirm & Approve</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT CONFIRMATION MODAL WITH MANDATORY NOTE */}
      {rejectingItem && (
        <div
          data-testid="reject-confirmation-modal"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950/50 flex items-center justify-center text-red-600 shrink-0">
                <Icon name="alert-triangle" className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Reject Evidence & Request Correction
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Incident ID: {rejectingItem.id}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Rejecting this submission will transition the incident status to <strong>Rejected (Correction Required)</strong>.
              The assigned authority will receive your rejection note and be required to re-perform the work or upload proper evidence.
            </p>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Mandatory Rejection Reason / Correction Directive <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                required
                placeholder="e.g. Photo does not show asphalt compaction; water ponding remains visible around the repair site."
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                className="w-full text-xs p-3 rounded-xl border border-red-300 dark:border-red-800/80 bg-red-50/20 dark:bg-slate-900/50 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
              />
              {!rejectionNote.trim() && (
                <div className="text-[10px] text-red-500 font-semibold">
                  A specific explanation is mandatory so the field team knows what to fix.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                disabled={actionLoading}
                onClick={() => setRejectingItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={!rejectionNote.trim() || actionLoading}
                onClick={handleReject}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {actionLoading ? (
                  <span>Rejecting…</span>
                ) : (
                  <>
                    <Icon name="alert-triangle" className="w-3.5 h-3.5" />
                    <span>Confirm Rejection</span>
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
