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

export default function WorkHistoryView({
  lang = 'en',
  authUser,
  onSelectComplaint,
  showToast = () => {},
}) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({
    total_assigned: 0,
    in_progress: 0,
    pending_verification: 0,
    verified: 0,
    rejected: 0,
  });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedItem, setSelectedItem] = useState(null);

  const fetchWorkHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '10',
      });
      if (statusFilter && statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      if (dateFrom) {
        params.append('date_from', dateFrom);
      }
      if (dateTo) {
        params.append('date_to', dateTo);
      }

      const res = await api(`/operations/work-history?${params.toString()}`);
      const rawItems = res.items || [];
      const normalizedItems = rawItems.map((item) => ({
        ...item,
        id: item.complaint_id || item.id,
        location: formatLocation(item.location),
      }));
      setItems(normalizedItems);
      setTotalPages(res.total_pages || 1);
      setTotalCount(res.total || 0);
      if (res.stats) {
        setStats(res.stats);
      }
    } catch (err) {
      showToast(err.message || 'Failed to load work history.');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, searchQuery, dateFrom, dateTo]);

  useEffect(() => {
    fetchWorkHistory();
  }, [fetchWorkHistory]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const getStatusBadge = (item) => {
    const status = item.status;
    const isVerified = item.admin_verified || item.verification_status === 'Verified' || status === 'Resolved';
    const isRejected = status === 'Rejected' || Boolean(item.rejection_reason);

    if (isVerified) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <Icon name="check-circle-2" className="w-3.5 h-3.5 text-emerald-600" />
          <span>{lang === 'bn' ? 'যাচাইকৃত সমাধান' : 'Verified Resolution'}</span>
        </span>
      );
    }
    if (isRejected) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          <Icon name="alert-triangle" className="w-3.5 h-3.5 text-red-600" />
          <span>{lang === 'bn' ? 'সংশোধন প্রয়োজন' : 'Correction Required'}</span>
        </span>
      );
    }
    if (status === 'Evidence Uploaded' || status === 'Verification') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
          <Icon name="clock" className="w-3.5 h-3.5 text-sky-600" />
          <span>{lang === 'bn' ? 'যাচাই অপেক্ষমাণ' : 'Pending Verification'}</span>
        </span>
      );
    }
    if (status === 'In Progress') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <Icon name="play" className="w-3.5 h-3.5 text-amber-600" />
          <span>{lang === 'bn' ? 'চলমান' : 'In Progress'}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
        <span>{status}</span>
      </span>
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
      const d = new Date(dateString);
      return d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', {
        year: 'numeric',
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
    <div data-testid="authority-work-history" className="space-y-6">
      {/* HEADER SECTION */}
      <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-7 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                {lang === 'bn' ? 'কর্তৃপক্ষের কাজের স্থায়ী ইতিহাস' : 'Authority Work History & Audit Trail'}
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {lang === 'bn'
                ? 'আপনার কর্তৃপক্ষের সম্পন্ন ও চলমান সকল কাজের স্থায়ী রেকর্ড। স্ট্যাটাস পরিবর্তন হলেও রেকর্ড মুছে যায় না।'
                : 'Permanent record of all municipal works executed by your authority. Completed and submitted tasks are permanently preserved and verifiable.'}
            </p>
          </div>
          <button
            onClick={fetchWorkHistory}
            disabled={loading}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 self-start sm:self-auto cursor-pointer transition-colors"
          >
            <Icon name="refresh-cw" className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            <span>{lang === 'bn' ? 'রিফ্রেশ' : 'Refresh'}</span>
          </button>
        </div>

        {/* METRICS STATS CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
            <div className="text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400 font-semibold">
              {lang === 'bn' ? 'মোট দায়িত্ব' : 'Total Assigned'}
            </div>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
              {stats.total_assigned}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60">
            <div className="text-[10px] font-mono uppercase text-amber-700 dark:text-amber-400 font-semibold">
              {lang === 'bn' ? 'চলমান' : 'In Progress'}
            </div>
            <div className="text-xl font-bold font-mono text-amber-700 dark:text-amber-300 mt-1">
              {stats.in_progress}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-sky-50/50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800/60">
            <div className="text-[10px] font-mono uppercase text-sky-700 dark:text-sky-400 font-semibold">
              {lang === 'bn' ? 'যাচাই অপেক্ষমাণ' : 'Pending Verification'}
            </div>
            <div className="text-xl font-bold font-mono text-sky-700 dark:text-sky-300 mt-1">
              {stats.pending_verification}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60">
            <div className="text-[10px] font-mono uppercase text-emerald-700 dark:text-emerald-400 font-semibold">
              {lang === 'bn' ? 'যাচাইকৃত সম্পন্ন' : 'Verified Resolved'}
            </div>
            <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-300 mt-1">
              {stats.verified}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-red-50/50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/60">
            <div className="text-[10px] font-mono uppercase text-red-700 dark:text-red-400 font-semibold">
              {lang === 'bn' ? 'সংশোধন প্রয়োজন' : 'Correction Required'}
            </div>
            <div className="text-xl font-bold font-mono text-red-700 dark:text-red-300 mt-1">
              {stats.rejected}
            </div>
          </div>
        </div>
      </div>

      {/* FILTER & SEARCH CONTROLS */}
      <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search Input */}
          <div className="relative">
            <Icon name="search" className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder={lang === 'bn' ? 'আইডি বা বিবরণ খুঁজুন...' : 'Search by ID or description...'}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="all">{lang === 'bn' ? 'সকল স্ট্যাটাস' : 'All Statuses'}</option>
              <option value="Assigned">{lang === 'bn' ? 'অ্যাসাইনকৃত' : 'Assigned'}</option>
              <option value="In Progress">{lang === 'bn' ? 'চলমান' : 'In Progress'}</option>
              <option value="Evidence Uploaded">{lang === 'bn' ? 'যাচাই অপেক্ষমাণ' : 'Pending Verification'}</option>
              <option value="Resolved">{lang === 'bn' ? 'যাচাইকৃত / সম্পন্ন' : 'Verified / Resolved'}</option>
              <option value="Rejected">{lang === 'bn' ? 'সংশোধন প্রয়োজন' : 'Rejected / Correction Required'}</option>
            </select>
          </div>

          {/* Date Range: From */}
          <div>
            <input
              type="date"
              aria-label="From Date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {/* Date Range: To */}
          <div className="flex gap-2">
            <input
              type="date"
              aria-label="To Date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
            {(searchQuery || statusFilter !== 'all' || dateFrom || dateTo) && (
              <button
                onClick={handleResetFilters}
                title="Reset filters"
                className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs shrink-0 cursor-pointer"
              >
                <Icon name="x" className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* WORK HISTORY TABLE */}
      <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50/60 dark:bg-slate-900/40">
          <div className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 uppercase">
            {lang === 'bn' ? `রেকর্ড তালিকা (${totalCount})` : `Audited Records (${totalCount})`}
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            Page {page} of {totalPages}
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400 font-mono">
            <Icon name="refresh-cw" className="w-5 h-5 mx-auto mb-2 animate-spin text-emerald-600" />
            Loading audited records…
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400 font-mono">
            No work history records found matching your filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-5">ID & Category</th>
                  <th className="py-3 px-5">Location</th>
                  <th className="py-3 px-5">Timeline</th>
                  <th className="py-3 px-5">Verification Status</th>
                  <th className="py-3 px-5">Evidence Proof</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {items.map((item) => {
                  const hasEvidence = Boolean(
                    item.after_image_url ||
                    item.resolution_evidence?.after_image_url ||
                    (item.evidence_versions && item.evidence_versions.length > 0)
                  );
                  const evidenceThumb =
                    item.after_image_url ||
                    item.resolution_evidence?.after_image_url ||
                    item.evidence_versions?.[item.evidence_versions.length - 1]?.image_url;

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* ID & Category */}
                      <td className="py-4 px-5 align-top">
                        <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {item.id}
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                          {item.category}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                          {item.title || item.description}
                        </div>
                      </td>

                      {/* Location */}
                      <td className="py-4 px-5 align-top font-mono text-[11px] text-slate-600 dark:text-slate-300 max-w-[180px]">
                        <div className="flex items-start gap-1">
                          <Icon name="map-pin" className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span className="line-clamp-2">{formatLocation(item.location)}</span>
                        </div>
                      </td>

                      {/* Timeline */}
                      <td className="py-4 px-5 align-top text-[11px] font-mono text-slate-500 dark:text-slate-400 space-y-1">
                        <div>
                          <span className="text-slate-400">Reported: </span>
                          <span className="text-slate-700 dark:text-slate-200">
                            {formatDate(item.created_at)}
                          </span>
                        </div>
                        {item.work_completed_at && (
                          <div>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Completed: </span>
                            <span className="text-slate-700 dark:text-slate-200">
                              {formatDate(item.work_completed_at)}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Verification Status */}
                      <td className="py-4 px-5 align-top">
                        <div className="space-y-1.5">
                          <div>{getStatusBadge(item)}</div>
                          {item.rejection_reason && (
                            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-[10px] text-red-700 dark:text-red-300">
                              <span className="font-bold">Admin Feedback: </span>
                              <span>{item.rejection_reason}</span>
                            </div>
                          )}
                          {item.admin_verification?.note && !item.rejection_reason && (
                            <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-[10px] text-emerald-700 dark:text-emerald-300">
                              <span className="font-bold">Admin Note: </span>
                              <span>{item.admin_verification.note}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Evidence Proof Thumbnail */}
                      <td className="py-4 px-5 align-top">
                        {hasEvidence && evidenceThumb ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setSelectedItem(item)}
                              className="group relative w-12 h-12 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm cursor-pointer"
                            >
                              <img
                                src={evidenceThumb}
                                alt="Resolution evidence thumbnail"
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                              />
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                <Icon name="camera" className="w-3.5 h-3.5" />
                              </div>
                            </button>
                            {item.evidence_versions && item.evidence_versions.length > 1 && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] font-mono text-slate-600 dark:text-slate-300">
                                v{item.evidence_versions.length}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] font-mono text-slate-400">
                            {lang === 'bn' ? 'কোনো প্রমাণ নেই' : 'No proof'}
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-4 px-5 align-top text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            data-testid={`view-proof-btn-${item.id}`}
                            onClick={() => setSelectedItem(item)}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-colors cursor-pointer"
                          >
                            {lang === 'bn' ? 'প্রমাণ ও বিস্তারিত' : 'View Proof'}
                          </button>
                          {onSelectComplaint && (
                            <button
                              onClick={() => onSelectComplaint(item)}
                              title="Open in operations workspace"
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition-colors cursor-pointer"
                            >
                              {lang === 'bn' ? 'কার্যক্ষেত্র' : 'Workspace'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* PAGINATION FOOTER */}
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

      {/* FULL RECORD DETAIL & EVIDENCE MODAL */}
      {selectedItem && (
        <div
          data-testid="work-history-detail-modal"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl max-w-3xl w-full p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-4">
              <div>
                <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                  PERMANENT AUDIT RECORD · {selectedItem.id}
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                  {selectedItem.category} — {selectedItem.title || selectedItem.description}
                </h3>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                  {formatLocation(selectedItem.location)}
                </p>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-2xl font-bold px-2 py-1 cursor-pointer"
              >
                ×
              </button>
            </div>

            {/* Status & Feedback Callout */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500 uppercase">Status:</span>
                <div>{getStatusBadge(selectedItem)}</div>
              </div>
              {selectedItem.work_completed_at && (
                <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                  <span className="text-slate-400">Completed at: </span>
                  <span className="font-semibold">{formatDate(selectedItem.work_completed_at)}</span>
                </div>
              )}
            </div>

            {selectedItem.rejection_reason && (
              <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-xs text-red-800 dark:text-red-200 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Icon name="alert-triangle" className="w-4 h-4 text-red-600" />
                  <span>Admin Rejection Reason & Required Correction:</span>
                </div>
                <p className="pl-5 leading-relaxed">{selectedItem.rejection_reason}</p>
              </div>
            )}

            {/* Before & After Interactive Comparison */}
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-mono">
                Visual Resolution Evidence Comparison
              </div>
              <InteractiveBeforeAfter
                beforeImage={selectedItem.beforeImage || selectedItem.image_url}
                afterImage={
                  selectedItem.after_image_url ||
                  selectedItem.resolution_evidence?.after_image_url ||
                  selectedItem.evidence_versions?.[selectedItem.evidence_versions.length - 1]?.image_url
                }
                altBefore="Original Reported Defect"
                altAfter="Authority Completed Resolution"
              />
            </div>

            {/* Completion Notes */}
            {(selectedItem.resolution_evidence?.completion_note || selectedItem.completion_description) && (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 text-xs">
                <div className="font-mono text-[10px] text-slate-400 uppercase font-bold">
                  Authority Field Completion Note
                </div>
                <p className="text-slate-800 dark:text-slate-200 mt-1 leading-relaxed">
                  {selectedItem.resolution_evidence?.completion_note || selectedItem.completion_description}
                </p>
              </div>
            )}

            {/* Evidence Version History */}
            {selectedItem.evidence_versions && selectedItem.evidence_versions.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 font-mono">
                  Evidence Version History ({selectedItem.evidence_versions.length} versions)
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  {selectedItem.evidence_versions.map((ver, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 bg-white dark:bg-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        {ver.image_url && (
                          <a
                            href={ver.image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 shrink-0 block"
                          >
                            <img src={ver.image_url} alt={`Version ${ver.version}`} className="w-full h-full object-cover" />
                          </a>
                        )}
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>Version {ver.version}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                              ver.verification_status === 'verified'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : ver.verification_status === 'rejected'
                                ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                            }`}>
                              {ver.verification_status || 'submitted'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {ver.completion_note || 'No notes specified.'}
                          </div>
                          {ver.admin_note && (
                            <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                              Feedback: {ver.admin_note}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 text-right shrink-0">
                        {formatDate(ver.uploaded_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Close
              </button>
              {onSelectComplaint && (
                <button
                  onClick={() => {
                    const item = selectedItem;
                    setSelectedItem(null);
                    onSelectComplaint(item);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                >
                  Open in Workspace →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
