import React, { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import Icon from './components/Icon.jsx';
import ReviewDialog from './components/ReviewDialog.jsx';
import InteractiveBeforeAfter from './components/InteractiveBeforeAfter.jsx';

    const absoluteMediaUrl = (url) => {
      if (!url || url.startsWith('http') || url.startsWith('data:') || url.startsWith('blob:')) return url;
      return `${window.location.origin}${url}`;
    };

    const DEMO_IMAGE_BY_CATEGORY = {
      'Road Infrastructure': 'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800',
      'Drainage / Sewerage': 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&q=80&w=800',
      'Waste Management': 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&q=80&w=800',
    };

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);

    export const normalizeReport = (item) => ({
      ...item,
      id: item.complaint_id || item.id,
      title: item.description || item.title || item.summary || 'Civic Issue',
      location: typeof item.location === 'string' ? item.location : item.location?.area || 'Location pending',
      coordinates: item.coordinates || { lat: item.location?.latitude, lng: item.location?.longitude },
      confidence: typeof item.confidence === 'number'
        ? `${item.needs_review ? 'Needs Human Review' : 'AI Confidence'} (${Math.round(item.confidence * 100)}%)`
        : item.confidence,
      duplicates: item.duplicate_count ?? item.duplicates ?? 0,
      beforeImage: absoluteMediaUrl(
        item.image_url
        || item.beforeImage
        || (item.data_label === 'Demo' ? DEMO_IMAGE_BY_CATEGORY[item.category] : null)
      ),
      afterImage: absoluteMediaUrl(item.resolution_evidence?.after_image_url || item.afterImage),
      timeline: (item.status_history || item.timeline || []).map(entry => ({
        step: entry.status || entry.step,
        time: entry.at ? new Date(entry.at).toLocaleString() : entry.time,
        note: entry.note,
        done: entry.done !== false,
      })),
    });

    const markerState = (report) => {
      const hasEvidence = Boolean(report.afterImage || report.resolution_evidence || report.officer_evidence_submitted);
      const citizenConfirmed = Boolean(report.citizen_verification?.fixed || report.resolution_approvals?.reporter || report.status === 'Resolved');
      if (citizenConfirmed || report.fully_verified) return { color: '#22c55e', label: 'Verified resolution' };
      if (hasEvidence) return { color: '#38bdf8', label: 'Evidence submitted · Awaiting citizen verification' };
      if (report.severity === 'Critical' || report.severity === 'High') return { color: '#ef4444', label: `${report.severity} unresolved problem` };
      return { color: '#eab308', label: `${report.severity || 'Moderate'} unresolved problem` };
    };

    function AuthorityMap({ reports, onSelect, useClusters = false }) {
      const mapNode = useRef(null);
      const mapInstance = useRef(null);
      useEffect(() => {
        if (!window.L || !mapNode.current) return;
        if (mapInstance.current) mapInstance.current.remove();
        const locatedReports = reports.filter(r => Number.isFinite(r.coordinates?.lat) && Number.isFinite(r.coordinates?.lng));
        const groups = new Map();
        locatedReports.forEach(report => {
          const key = report.incident_id || report.id;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(report);
        });
        const located = [...groups.values()].map(group => ({...group[0], incidentReportCount: group.length}));
        const center = located.length ? [located[0].coordinates.lat, located[0].coordinates.lng] : [22.3475, 91.8123];
        const map = window.L.map(mapNode.current, { zoomControl: false }).setView(center, 12);
        window.L.control.zoom({ position: 'bottomright' }).addTo(map);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
        }).addTo(map);
        const markerLayer = window.L.layerGroup().addTo(map);
        const renderReports = () => located.forEach(report => {
          const state = markerState(report);
          const color = state.color;
          const marker = window.L.circleMarker([report.coordinates.lat, report.coordinates.lng], {
            radius: (report.severity === 'Critical' ? 10 : 8) + Math.min((report.incidentReportCount || 1) - 1, 6),
            color: color,
            fillColor: color,
            fillOpacity: 0.85,
            weight: 2
          }).addTo(markerLayer);
          marker.bindPopup(`
            <div class="p-1 space-y-1.5 font-sans">
              <div class="flex items-center justify-between gap-2 border-b border-slate-700/60 pb-1">
                <strong class="font-mono text-sky-400 text-xs">${escapeHtml(report.incident_id || report.id)}</strong>
                <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">${escapeHtml(report.status)}</span>
              </div>
              <div class="text-xs font-semibold text-white">${escapeHtml(report.category)}</div>
              <div class="text-[11px] text-slate-400 flex items-center gap-1">${escapeHtml(report.location)}</div>
              <div class="text-[10px] font-mono text-sky-300 bg-sky-950/60 rounded px-1.5 py-0.5 mt-1">${escapeHtml(state.label)}</div>
              ${report.incidentReportCount > 1 ? `<div class="text-[10px] text-emerald-400 font-mono">👥 ${report.incidentReportCount} citizen reports linked</div>` : ''}
              ${report.community_repair_interest_count ? `<div class="text-[10px] text-amber-400 font-mono">🛠️ ${Number(report.community_repair_interest_count) || 0} proposal(s) received</div>` : ''}
            </div>
          `).on('click', () => onSelect(report));
        });
        const renderClusters = async () => {
          const bounds = map.getBounds();
          try {
            const result = await api(`/complaints/map/clusters?west=${bounds.getWest()}&south=${bounds.getSouth()}&east=${bounds.getEast()}&north=${bounds.getNorth()}&zoom=${map.getZoom()}`);
            markerLayer.clearLayers();
            result.clusters.forEach(cluster => {
              const urgent = cluster.critical_count > 0;
              const marker = window.L.circleMarker([cluster.latitude, cluster.longitude], {radius: Math.min(9 + Math.log2(cluster.count + 1) * 4, 26), color: urgent ? '#ef4444' : '#0ea5e9', fillColor: urgent ? '#ef4444' : '#0ea5e9', fillOpacity:.82, weight:2}).addTo(markerLayer);
              marker.bindTooltip(String(cluster.count), {permanent:true, direction:'center', className:'cluster-count'});
              marker.on('click', async () => {
                if (cluster.count > 1) return map.setView([cluster.latitude, cluster.longitude], Math.min(map.getZoom() + 2, 19));
                if (cluster.complaint_id) {
                  const complaint = normalizeReport(await api(`/complaints/${cluster.complaint_id}`));
                  onSelect(complaint);
                }
              });
            });
          } catch (_) { markerLayer.clearLayers(); renderReports(); }
        };
        if (useClusters) { map.on('moveend', renderClusters); renderClusters(); } else renderReports();
        if (located.length > 1) map.fitBounds(located.map(r => [r.coordinates.lat, r.coordinates.lng]), { padding: [40, 40] });
        mapInstance.current = map;
        return () => { map.remove(); mapInstance.current = null; };
      }, [reports, useClusters]);
      return <div ref={mapNode} className="h-[460px] w-full rounded-2xl overflow-hidden border border-slate-800/80 shadow-2xl bg-civic-obsidian" />;
    }

    function LocationPicker({ latitude, longitude, onPick }) {
      const mapNode = useRef(null);
      const pickerNode = useRef(null);
      const onPickRef = useRef(onPick);
      useEffect(() => { onPickRef.current = onPick; }, [onPick]);
      useEffect(() => {
        if (!window.L || !mapNode.current) return;
        const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
        const center = hasLocation ? [latitude, longitude] : [22.3475, 91.8123];
        const map = window.L.map(mapNode.current, { zoomControl: false }).setView(center, hasLocation ? 17 : 12);
        window.L.control.zoom({ position: 'bottomright' }).addTo(map);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
        }).addTo(map);
        const selectCenter = () => {
          const { lat, lng } = map.getCenter();
          pickerNode.current?.classList.remove('is-moving');
          onPickRef.current(lat, lng);
        };
        map.on('movestart', () => pickerNode.current?.classList.add('is-moving'));
        map.on('moveend', selectCenter);
        map.on('click', event => map.panTo(event.latlng));
        setTimeout(() => map.invalidateSize(), 0);
        return () => map.remove();
      }, []);
      return (
        <div ref={pickerNode} className="location-picker relative h-80 w-full rounded-xl overflow-hidden glass-card border border-slate-800">
          <div className="absolute top-3 left-3 z-[450] bg-slate-900 border border-slate-700 text-xs text-sky-300 px-3 py-2 rounded-lg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400"></span>
            Drag map to place pin on exact spot
          </div>
          <div ref={mapNode} className="h-full w-full" aria-label="Move the map to place its center on the report location" />
          <div className="location-picker-pin" aria-hidden="true">
            <Icon name="map-pin" className="w-10 h-10 text-red-500 drop-shadow-lg" />
          </div>
        </div>
      );
    }


    // --- MOCK DATABASE ---
    const INITIAL_REPORTS = [
      {
        id: 'CP-88412',
        category: 'Road Infrastructure',
        title: 'Severe Asphalt Crater near Agrabad Access Road',
        location: 'Agrabad Commercial Area, Chattogram',
        coordinates: { lat: 22.3262, lng: 91.8124 },
        severity: 'Critical',
        status: 'In Progress',
        data_label: 'Demo',
        priority_score: 92,
        priority_breakdown: { severity: 46, duplicates_and_affected: 18, age: 8, location_impact: 14, critical_safety: 6 },
        department: 'Engineering Department (Road Maintenance)',
        assigned_authority: {
          authority_id: 'AUTH-CCC',
          authority_name: 'Chattogram City Corporation',
          short_code: 'CCC',
          department: 'Engineering Department (Road Maintenance)',
          jurisdiction: 'Chattogram Metropolitan Area',
          routing_status: 'assigned',
          routing_method: 'administrative_area_keyword',
          routing_confidence: 0.88,
          data_status: 'pending_verification',
          assignment_reason: 'Matched to Chattogram City Corporation (Engineering Department (Road Maintenance)) via administrative_area_keyword.'
        },
        reportedAt: '2026-08-20T09:12:00Z',
        confidence: 'High Confidence (98.4%)',
        duplicates: 4,
        beforeImage: 'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800',
        afterImage: null,
        description: 'Deep road crater across the commercial access lane creating severe vehicular bottlenecks during peak transit hours.',
        timeline: [
          { step: 'Reported', time: '09:12 AM', done: true },
          { step: 'AI Assessed', time: '09:13 AM', done: true },
          { step: 'Assigned', time: '09:30 AM', done: true },
          { step: 'In Progress', time: '10:15 AM', done: true },
          { step: 'Resolved', time: 'Pending Evidence', done: false }
        ]
      },
      {
        id: 'CP-88390',
        category: 'Waste Management',
        title: 'Overflowing Municipal Waste Collection Point',
        location: 'Nasirabad Housing Society, Chattogram',
        coordinates: { lat: 22.3587, lng: 91.8215 },
        severity: 'High',
        status: 'Resolved',
        data_label: 'Demo',
        priority_score: 71,
        priority_breakdown: { severity: 30, duplicates_and_affected: 9, age: 10, location_impact: 17, critical_safety: 5 },
        resolution_approvals: { contractor: true, government: true },
        fully_verified: true,
        department: 'Conservancy Department (Waste Management)',
        assigned_authority: {
          authority_id: 'AUTH-CCC',
          authority_name: 'Chattogram City Corporation',
          short_code: 'CCC',
          department: 'Conservancy Department (Waste Management)',
          jurisdiction: 'Chattogram Metropolitan Area',
          routing_status: 'assigned',
          assignment_status: 'auto_assigned',
          routing_method: 'administrative_area_keyword',
          routing_confidence: 0.88,
          authority_data_status: 'candidate_registry',
          jurisdiction_data_status: 'keyword_inferred',
          integration_status: 'simulated',
          environment: 'demo',
          data_status: 'pending_verification',
          assignment_reason: 'Matched to Chattogram City Corporation (Conservancy Department (Waste Management)) via administrative_area_keyword.'
        },
        reportedAt: '2026-08-19T14:20:00Z',
        confidence: 'High Confidence (96.1%)',
        duplicates: 1,
        beforeImage: 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&q=80&w=800',
        afterImage: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?auto=format&fit=crop&q=80&w=800',
        description: 'Commercial waste spill overflowing onto pedestrian walkway.',
        timeline: [
          { step: 'Reported', time: '02:20 PM', done: true },
          { step: 'AI Assessed', time: '02:21 PM', done: true },
          { step: 'Assigned', time: '02:45 PM', done: true },
          { step: 'In Progress', time: '03:10 PM', done: true },
          { step: 'Resolved', time: '05:00 PM', done: true }
        ]
      },
      {
        id: 'CP-88210',
        category: 'Drainage / Sewerage',
        title: 'Monsoon Waterlogging & Blocked Culvert',
        location: 'Muradpur Junction, Chattogram',
        coordinates: { lat: 22.3654, lng: 91.8291 },
        severity: 'Critical',
        status: 'Needs Review',
        data_label: 'Demo',
        priority_score: 86,
        priority_breakdown: { severity: 46, duplicates_and_affected: 6, age: 8, location_impact: 20, critical_safety: 6 },
        department: 'Drainage & Flood Management Circle',
        assigned_authority: {
          authority_id: 'AUTH-CCC',
          authority_name: 'Chattogram City Corporation',
          short_code: 'CCC',
          department: 'Drainage & Flood Management Circle',
          jurisdiction: 'Chattogram Metropolitan Area',
          routing_status: 'needs_review',
          assignment_status: 'needs_review',
          routing_method: 'administrative_area_keyword',
          routing_confidence: 0.88,
          authority_data_status: 'candidate_registry',
          jurisdiction_data_status: 'keyword_inferred',
          integration_status: 'simulated',
          environment: 'demo',
          data_status: 'pending_verification',
          assignment_reason: 'Monsoon waterlogging requires officer site verification for emergency pump deployment.'
        },
        reportedAt: '2026-08-20T11:45:00Z',
        confidence: 'Needs Human Review',
        duplicates: 0,
        beforeImage: 'https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&q=80&w=800',
        afterImage: null,
        description: 'Water leaking continuously from underground main valve.',
        timeline: [
          { step: 'Reported', time: '11:45 AM', done: true },
          { step: 'AI Assessed', time: '11:46 AM', done: true },
          { step: 'Assigned', time: 'Pending', done: false },
          { step: 'In Progress', time: 'Pending', done: false },
          { step: 'Resolved', time: 'Pending', done: false }
        ]
      }
    ];

    function AuthCard({ title, subtitle, mode, setMode, form, setForm, submit, busy, error, allowRegister = true, demoCredentials = false, onDemoOfficerLogin = null }) {
      const [showPassword, setShowPassword] = useState(false);
      const registering = allowRegister && mode === 'register';
      const emailValid = !allowRegister || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());
      const passwordValid = form.password.length >= (registering ? 8 : 1);
      const passwordsMatch = !registering || form.password === form.confirmPassword;
      const canSubmit = !busy && emailValid && passwordValid && (!registering || (form.name.trim().length >= 2 && passwordsMatch));
      return (
        <div className="max-w-xl mx-auto bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-6 sm:p-10 space-y-6">
          <div className="text-left border-b border-slate-200 dark:border-slate-700 pb-5">
            <div className="inline-flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-full text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-3 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>{allowRegister ? 'নাগরিক ও যুব কর্মী পোর্টাল · Civic Gate' : 'পৌর কর্তৃপক্ষ লগইন · Municipal Admin Gate'}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold font-headline text-slate-900 dark:text-white tracking-tight">{title}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{subtitle}</p>
          </div>

          {allowRegister && (
            <div className="grid grid-cols-2 bg-slate-100 dark:bg-slate-700/60 p-1 rounded-xl">
              <button onClick={()=>setMode('login')} className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${mode==='login'?'bg-emerald-600 text-white shadow-sm':'text-slate-600 dark:text-slate-300 hover:text-slate-900'}`}>লগইন (Login)</button>
              <button onClick={()=>setMode('register')} className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${mode==='register'?'bg-emerald-600 text-white shadow-sm':'text-slate-600 dark:text-slate-300 hover:text-slate-900'}`}>নিবন্ধন (Register)</button>
            </div>
          )}

          {/* CREDENTIAL INPUTS - FRONT & CENTER */}
          <div className="space-y-4">
            {allowRegister && mode==='register' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">পূর্ণ নাম (Full Name)</label>
                  <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name" autoComplete="name" className="w-full rounded-xl p-3.5 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm focus:outline-none"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">ফোন নম্বর (Phone Number)</label>
                  <input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="01XXXXXXXXX" autoComplete="tel" className="w-full rounded-xl p-3.5 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm focus:outline-none"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">পেমেন্ট অ্যাকাউন্ট (Stripe / MFS Account)</label>
                  <input value={form.payoutAccount || ''} onChange={e=>setForm({...form,payoutAccount:e.target.value})} placeholder="Account details (optional)" className="w-full rounded-xl p-3.5 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm focus:outline-none"/>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                <span>{allowRegister ? 'ইমেইল অ্যাড্রেস (Email Address)' : 'অফিসার ইউজারনেম (Admin / Officer Username)'}</span>
                {!allowRegister && <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">e.g. admin or officer.ccc</span>}
              </label>
              <input 
                type={allowRegister ? 'email' : 'text'} 
                value={form.email} 
                onChange={e => setForm({...form, email: e.target.value})} 
                placeholder={allowRegister ? 'Email address' : 'Admin username'} 
                autoComplete="username" 
                className="w-full rounded-xl p-3.5 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                <span>পাসওয়ার্ড (Password)</span>
                {!allowRegister && <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">admin or demo password</span>}
              </label>
              <div className="relative">
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={form.password} 
                  onChange={e => setForm({...form, password: e.target.value})} 
                  placeholder="Password" 
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'} 
                  onKeyDown={e => e.key === 'Enter' && canSubmit && submit()} 
                  className="w-full rounded-xl p-3.5 pr-16 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm focus:outline-none"
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(value => !value)} 
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-emerald-600 cursor-pointer px-1 py-0.5"
                >
                  {showPassword ? 'লুকান' : 'দেখান'}
                </button>
              </div>
            </div>

            {registering && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">পাসওয়ার্ড নিশ্চিত করুন (Confirm Password)</label>
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={form.confirmPassword} 
                  onChange={e => setForm({...form, confirmPassword: e.target.value})} 
                  placeholder="Confirm password" 
                  autoComplete="new-password" 
                  onKeyDown={e => e.key === 'Enter' && canSubmit && submit()} 
                  className={`w-full rounded-xl p-3.5 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-900 border shadow-sm focus:outline-none ${form.confirmPassword && !passwordsMatch ? 'border-red-500' : 'border-slate-300 dark:border-slate-700'}`}
                />
                <div className="flex justify-between text-[11px] px-1 mt-1 font-medium">
                  <span className={passwordValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>{passwordValid ? '✓ ৮+ অক্ষর' : 'কমপক্ষে ৮ অক্ষর'}</span>
                  {form.confirmPassword && <span className={passwordsMatch ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{passwordsMatch ? '✓ মিল আছে' : 'পাসওয়ার্ড মিলেনি'}</span>}
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                <Icon name="alert-circle" className="w-4 h-4 text-red-500 shrink-0"/>
                <span>{error}</span>
              </div>
            )}

            <button 
              onClick={() => submit()} 
              disabled={!canSubmit} 
              className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-sm shadow-md hover:shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Icon name="shield-check" className="w-5 h-5 text-white" />
              <span>{busy ? 'প্রবেশ করা হচ্ছে…' : mode === 'register' ? 'অ্যাকাউন্ট তৈরি করুন →' : 'লগইন করুন ও প্রবেশ করুন →'}</span>
            </button>
          </div>

          {/* QUICK DEMO LOGIN SHORTCUTS */}
          {demoCredentials && (
            <div className="border-t border-slate-200 dark:border-slate-700 pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">দ্রুত পরীক্ষামূলক লগইন (Demo Access)</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">1-CLICK ACCESS</span>
              </div>

              <button 
                type="button" 
                onClick={() => setForm({...form, email: 'admin', password: 'admin'})} 
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3.5 text-left hover:border-emerald-500/50 hover:bg-emerald-50/20 dark:hover:bg-emerald-950/20 transition-all cursor-pointer flex items-center justify-between gap-3 group shadow-sm"
              >
                <div>
                  <div className="font-bold text-xs text-slate-900 dark:text-white group-hover:text-emerald-600 transition-colors">
                    ⚡ Judge demo access (Administrator)
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Fills: <span className="font-semibold text-slate-700 dark:text-slate-300">username: admin</span> · <span className="font-semibold text-slate-700 dark:text-slate-300">password: admin</span>
                  </div>
                </div>
                <span className="shrink-0 text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold shadow-sm">
                  FILL ADMIN
                </span>
              </button>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 space-y-2.5">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>সিটি করপোরেশন ও পৌর অফিসার (Direct Officer Login)</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">তাৎক্ষণিক সেশন</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { code: 'officer.ccc', label: 'CCC (চট্টগ্রাম)', auth: 'AUTH-CCC' },
                    { code: 'officer.dncc', label: 'DNCC (ঢাকা উত্তর)', auth: 'AUTH-DNCC' },
                    { code: 'officer.dscc', label: 'DSCC (ঢাকা দক্ষিণ)', auth: 'AUTH-DSCC' },
                    { code: 'officer.dwasa', label: 'DWASA (পানি ও ড্রেনেজ)', auth: 'AUTH-DWASA' },
                  ].map(item => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => onDemoOfficerLogin ? onDemoOfficerLogin(item.code) : setForm({...form, email: item.code})}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-emerald-500 hover:text-emerald-600 transition-all shadow-sm cursor-pointer"
                    >
                      <div className="font-semibold">{item.label}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{item.code}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // --- BILINGUAL BANGLADESH CIVIC TRANSLATION DICTIONARY ---
    const I18N = {
      en: {
        home: 'Home',
        reportIssue: 'Report Issue',
        trackReport: 'Track Report',
        publicMap: 'Public Map',
        authorityPortal: 'Authority Portal',
        tickerStatus: 'CITIZEN SERVICES · LIVE CITY MONITORING',
        tickerPill1: 'NO APP DOWNLOAD REQUIRED',
        tickerPill2: 'AVG DISPATCH: 4.2 HRS',
        tickerPill3: 'ACTIVE INCIDENTS:',
        tickerPill4: 'MUNICIPAL AUDIT 2026',
        govBadge: 'PEOPLE\'S REPUBLIC OF BANGLADESH · CIVIC PLATFORM',
        heroTitle1: 'See a problem in your area?',
        heroTitle2: 'Report it directly to authorities.',
        heroSubtext: 'Take a photo, share the location, and track municipal action in real time. No app download or prior registration required.',
        reportBtn: 'Report an Issue',
        trackBtn: 'Track a Report',
        check1: 'No account needed',
        check2: 'Get a report ID',
        check3: 'See proof when fixed',
        categoriesBadge: 'POPULAR CATEGORIES',
        categoriesTitle: 'Common Municipal Issues',
        categoriesSub: 'Select a category below for rapid AI categorization and direct department routing',
        catRoadsTitle: 'Roads & Potholes',
        catRoadsSub: 'Damaged asphalt, potholes, open manholes, footpaths',
        catDrainageTitle: 'Waterlogging & Drains',
        catDrainageSub: 'Monsoon overflow, blocked drains, CWASA/DWASA lines',
        catWasteTitle: 'Waste & Sanitation',
        catWasteSub: 'Overflowing dumpsters, roadside waste, uncollected garbage',
        catLightsTitle: 'Street Lights & Cables',
        catLightsSub: 'Broken streetlights, dangling live wires, electric poles',
        howItWorksTitle: 'Report. Track. Verify.',
        howItWorksSub: 'A simple process, with a clear record at every step.',
        step1Num: '01',
        step1Title: 'Report',
        step1Desc: 'Take or upload a photo, add the location, and briefly describe the problem.',
        step1Meta: 'STEP DURATION: < 60 SECONDS',
        step2Num: '02',
        step2Title: 'Track',
        step2Desc: 'Save your report ID and check progress whenever you need to.',
        step2Meta: 'REAL-TIME MUNICIPAL DISPATCH SYNC',
        step3Num: '03',
        step3Title: 'Verify',
        step3Desc: 'See the repair evidence and whether the resolution has been confirmed.',
        step3Meta: 'INCLUDES PHOTOGRAPHIC PROOF',
        metricsBadge: 'LIVE PERFORMANCE METRICS',
        metric1Val: '12,840',
        metric1Label: 'Incidents Logged',
        metric1Desc: 'Citizen reports received across municipal wards.',
        metric1Meta: 'All City Corporations',
        metric2Val: '89.4%',
        metric2Label: 'Resolution Rate',
        metric2Desc: 'Verified fixes backed by citizen confirmation.',
        metric2Meta: 'Citizen Verified',
        metric3Val: '18.2h',
        metric3Label: 'Avg Dispatch Turn',
        metric3Desc: 'Average time from report submission to field crew mobilization.',
        metric3Meta: 'Statutory SLA',
        metric4Val: '100%',
        metric4Label: 'Public Transparency',
        metric4Desc: 'All verified cases accessible on the public map.',
        metric4Meta: 'Open Citizen Ledger',
        sliderBadge: 'RESOLUTION EVIDENCE',
        sliderTitle: 'Interactive Before & After Verification',
        sliderSub: 'Drag the slider to compare original citizen reports with verified municipal repairs.',
        sliderTag: 'TWO-PARTY AUDITED',
        bannerTitle: 'Spot a civic hazard right now? No app required.',
        bannerSub: 'Open camera, pin your coordinates, and UrbanFix routes directly to the assigned zone authority.',
        hotline: 'Civic Helpline: 16104 / 311',
        bannerBtn: 'Report Issue Now'
      },
      bn: {
        home: 'হোম',
        reportIssue: 'অভিযোগ করুন',
        trackReport: 'ট্র্যাক করুন',
        publicMap: 'সিটি ম্যাপ',
        authorityPortal: 'কর্তৃপক্ষ পোর্টাল',
        tickerStatus: 'নাগরিক সেবা ও পৌর অভিযোগ ব্যবস্থাপনা প্ল্যাটফর্ম · লাইভ মনিটরিং',
        tickerPill1: 'অ্যাপ ছাড়াই সরাসরি ব্রাউজার থেকে অভিযোগ',
        tickerPill2: 'গড় ব্যবস্থা গ্রহণ: ৪.২ ঘণ্টা',
        tickerPill3: 'চলমান অভিযোগ:',
        tickerPill4: 'ডিজিটাল বাংলাদেশ নাগরিক সেবা ২০২৬',
        govBadge: 'গণপ্রজাতন্ত্রী বাংলাদেশ · ডিজিটাল পৌর নাগরিক প্ল্যাটফর্ম',
        heroTitle1: 'এলাকায় কোনো নাগরিক সমস্যা দেখছেন?',
        heroTitle2: 'সরাসরি সিটি কর্তৃপক্ষকে জানান।',
        heroSubtext: 'একটি ছবি তুলুন, লোকেশন দিন এবং সমাধান না হওয়া পর্যন্ত সরাসরি ট্র্যাক করুন। কোনো অ্যাপ ইনস্টল বা পূর্ব নিবন্ধনের প্রয়োজন নেই।',
        reportBtn: 'অভিযোগ দায়ের করুন',
        trackBtn: 'অভিযোগ ট্র্যাক করুন',
        check1: 'অ্যাকাউন্ট ছাড়াই তাৎক্ষণিক অভিযোগ',
        check2: 'এসএমএস ও ট্র্যাকিং নম্বর',
        check3: 'ছবিসহ সমাধান নিশ্চিতকরণ',
        categoriesBadge: 'জরুরি নাগরিক সেবা',
        categoriesTitle: 'সমস্যার ধরন বেছে নিন',
        categoriesSub: 'দ্রুত সমাধানের জন্য নিচের ক্যাটাগরি থেকে সরাসরি অভিযোগ দাখিল করুন',
        catRoadsTitle: 'ভাঙা রাস্তা ও ম্যানহোল',
        catRoadsSub: 'ভাঙা পিচ, বিপজ্জনক গর্ত, খোলা ম্যানহোল, ফুটপাত ক্ষতি',
        catDrainageTitle: 'জলাবদ্ধতা ও ড্রেন',
        catDrainageSub: 'বৃষ্টির পানি জমে থাকা, বন্ধ নালা, ড্রেন উপচে পড়া',
        catWasteTitle: 'বর্জ্য ও ময়লা-আবর্জনা',
        catWasteSub: 'রাস্তায় আবর্জনার স্তূপ, উপচে পড়া ডাস্টবিন, দুর্গন্ধ',
        catLightsTitle: 'সড়ক বাতি ও বৈদ্যুতিক তার',
        catLightsSub: 'নষ্ট সড়ক বাতি, অন্ধকার পথ, বিপজ্জনকভাবে ঝুলন্ত তার',
        howItWorksTitle: 'রিপোর্ট. ট্র্যাক. যাচাই.',
        howItWorksSub: 'প্রতিটি পদক্ষেপে স্পষ্ট ও সুনির্দিষ্ট রেকর্ডসহ একটি সহজ প্রক্রিয়া।',
        step1Num: '০১',
        step1Title: 'রিপোর্ট (Report)',
        step1Desc: 'একটি ছবি তুলুন বা আপলোড করুন, লোকেশন দিন এবং সংক্ষেপে সমস্যাটি লিখুন।',
        step1Meta: 'ধাপের সময়সীমা: < ৬০ সেকেন্ড',
        step2Num: '০২',
        step2Title: 'ট্র্যাক (Track)',
        step2Desc: 'আপনার রিপোর্ট আইডি সংরক্ষণ করুন এবং প্রয়োজনমতো যেকোনো সময় অগ্রগতি দেখুন।',
        step2Meta: 'রিয়েল-টাইম পৌর ডিসপ্যাচ সিঙ্ক',
        step3Num: '০৩',
        step3Title: 'যাচাই (Verify)',
        step3Desc: 'মেরামতের প্রমাণ ও ছবি দেখুন এবং সমাধান নিশ্চিত করা হয়েছে কি না যাচাই করুন।',
        step3Meta: 'আলোকচিত্র প্রমাণ অন্তর্ভুক্ত',
        metricsBadge: 'লাইভ কার্যক্রম পরিসংখ্যান',
        metric1Val: '১২,৮৪০',
        metric1Label: 'মোট গৃহীত অভিযোগ',
        metric1Desc: 'বিভিন্ন সিটি করপোরেশন ও পৌরসভায় দায়েরকৃত নাগরিক অভিযোগ।',
        metric1Meta: 'সকল পৌর ওয়ার্ড',
        metric2Val: '৮৯.৪%',
        metric2Label: 'সফল সমাধানের হার',
        metric2Desc: 'নাগরিক কর্তৃক ছবিসহ যাচাইকৃত সম্পূর্ণ সমাধান।',
        metric2Meta: 'নাগরিক কর্তৃক অনুমোদিত',
        metric3Val: '১৮.২ ঘণ্টা',
        metric3Label: 'গড় ব্যবস্থা গ্রহণের সময়',
        metric3Desc: 'অভিযোগ প্রাপ্তি থেকে ফিল্ড টিম মোতায়েনের গড় সময়।',
        metric3Meta: 'পৌর মানদণ্ড',
        metric4Val: '১০০%',
        metric4Label: 'উন্মুক্ত নাগরিক তথ্য',
        metric4Desc: 'জনস্বার্থে সকল রিপোর্ট উন্মুক্ত সিটি ম্যাপে দৃশ্যমান।',
        metric4Meta: 'স্বচ্ছ নাগরিক অডিট',
        sliderBadge: 'সমাধানের বাস্তব প্রমাণ',
        sliderTitle: 'কাজের আগের ও পরের দৃশ্য (ইন্টারেক্টিভ স্লাইডার)',
        sliderSub: 'স্লাইডারটি টেনে দেখুন কীভাবে অভিযোগ অনুযায়ী পৌর মেরামত কাজ সম্পন্ন হয়েছে।',
        sliderTag: 'দ্বিপাক্ষিক যাচাইকৃত',
        bannerTitle: 'আপনার এলাকায় কোনো জরুরি নাগরিক সমস্যা আছে?',
        bannerSub: 'ভাঙা রাস্তা, জলাবদ্ধতা বা আবর্জনার সমস্যা সরাসরি রিপোর্ট করুন এখনই। কোনো অ্যাপ লাগবে না।',
        hotline: 'পৌর নাগরিক হটলাইন: ১৬১০৪ / ৩১১',
        bannerBtn: 'এখনই অভিযোগ দায়ের করুন'
      }
    };

    // --- MAIN APP COMPONENT ---
    export default function App() {
      const [activeTab, setActiveTab] = useState('landing');
      const [lang, setLang] = useState(() => localStorage.getItem('urbanfix-lang') || 'bn');
      const [darkMode, setDarkMode] = useState(() => localStorage.getItem('urbanfix-theme') === 'dark');
      const [reports, setReports] = useState(INITIAL_REPORTS);
      const [reportsTruncated, setReportsTruncated] = useState(false);
      const [selectedReport, setSelectedReport] = useState(null);
      
      // Before/After Slider
      const [sliderPos, setSliderPos] = useState(50);

      // Multi-step Citizen Form
      const [reportStep, setReportStep] = useState(1);
      const [uploadedImage, setUploadedImage] = useState(null);
      const [uploadedFile, setUploadedFile] = useState(null);
      const [aiAnalysis, setAiAnalysis] = useState(null);
      const [dashboard, setDashboard] = useState(null);
      const [isSubmitting, setIsSubmitting] = useState(false);
      const [trackingError, setTrackingError] = useState('');
      const [trackingBusy, setTrackingBusy] = useState(false);
      const [mapFilter, setMapFilter] = useState('All');
      const [trackingQuery, setTrackingQuery] = useState('');
      const [submittedReportId, setSubmittedReportId] = useState('');
      const [repairRequests, setRepairRequests] = useState([]);
      const [repairForm, setRepairForm] = useState({ complaint_id: '', estimated_price: '', plan: '', estimated_hours: 24 });
      const [adminView, setAdminView] = useState('queue');
      const [operationDetail, setOperationDetail] = useState(null);
      const [operationLoading, setOperationLoading] = useState(false);
      const [accountabilityReceipt, setAccountabilityReceipt] = useState(null);
      const [offerForm, setOfferForm] = useState({ contractor_id: '', budget_cap: '', sla_hours: 24 });
      const [contractorJobs, setContractorJobs] = useState([]);
      const [contractorProfile, setContractorProfile] = useState(null);
      const [contractors, setContractors] = useState([]);
      const [contractorForm, setContractorForm] = useState({service_area:'',skills:'',payout_account_id:''});
      const [contractorProofs, setContractorProofs] = useState({});
      const [reviewReport, setReviewReport] = useState(null);
      const [reviewBusy, setReviewBusy] = useState(false);
      const [fundingBudgets, setFundingBudgets] = useState({});
      const [authUser, setAuthUser] = useState(null);
      const [verificationToken, setVerificationToken] = useState('');
      const [citizenFeedback, setCitizenFeedback] = useState('');
      const [isVerifying, setIsVerifying] = useState(false);
      const [officerProgressNote, setOfficerProgressNote] = useState('');
      const [evidenceFile, setEvidenceFile] = useState(null);
      const [evidenceNote, setEvidenceNote] = useState('');
      const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
      const [authMode, setAuthMode] = useState('login');
      const [authForm, setAuthForm] = useState({name:'',email:'',password:'',confirmPassword:'',phone:'',payoutAccount:''});
      const [authBusy, setAuthBusy] = useState(false);
      const [authError, setAuthError] = useState('');
      const [isAnalyzing, setIsAnalyzing] = useState(false);
      const [analysisComplete, setAnalysisComplete] = useState(false);
      const [photoLocation, setPhotoLocation] = useState(null);
      const [showLocationMap, setShowLocationMap] = useState(false);
      const [reportForm, setReportForm] = useState({
        category: 'Let AI decide',
        severity: 'High',
        location: '',
        description: '',
        latitude: null,
        longitude: null,
        locationSource: null,
        locationConfirmed: false,
        locationAccuracy: null,
        photoCapturedAt: null,
        reporterContact: ''
      });

      // Admin Filters
      const [searchQuery, setSearchQuery] = useState('');
      const [queueFilters, setQueueFilters] = useState({days:'all',state:'unresolved',category:'all',severity:'all',sort:'priority'});
      const [toast, setToast] = useState(null);
      const authUserRef = useRef(null);
      const authVersionRef = useRef(0);
      const reportSubmissionKeyRef = useRef(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

      useEffect(() => { authUserRef.current = authUser; }, [authUser]);

      useEffect(() => () => { if (uploadedImage?.startsWith('blob:')) URL.revokeObjectURL(uploadedImage); }, [uploadedImage]);

      useEffect(() => {
        document.documentElement.classList.toggle('dark', darkMode);
        localStorage.setItem('urbanfix-theme', darkMode ? 'dark' : 'light');
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', darkMode ? '#0B0F17' : '#059669');
      }, [darkMode]);

      useEffect(() => {
        localStorage.setItem('urbanfix-lang', lang);
        document.documentElement.lang = lang;
      }, [lang]);

      const t = I18N[lang] || I18N.bn;

      useEffect(() => {
        loadSession();
        const timer = setInterval(() => refreshData(authUserRef.current), 30000);
        return () => clearInterval(timer);
      }, []);

      const loadSession = async () => {
        const requestVersion = authVersionRef.current;
        try {
          const user = await api('/auth/me');
          if (requestVersion !== authVersionRef.current) return;
          window.URBANFIX_CSRF = user.csrf_token;
          setAuthUser(user);
          await refreshData(user);
        } catch (error) {
          if (requestVersion !== authVersionRef.current) return;
          if (error.status === 401) {
            window.URBANFIX_CSRF = '';
            setAuthUser(null);
            await refreshData(null);
          } else {
            await refreshData(authUserRef.current);
            if (authUserRef.current) showToast('Connection interrupted. Your account remains signed in and will retry automatically.');
          }
        }
      };

      const refreshData = async (knownUser = authUser) => {
        try {
          const complaintData = await api('/complaints');
          const liveReports = complaintData.complaints.map(normalizeReport);
          setReportsTruncated(Boolean(complaintData.pagination?.has_more));
          setReports(liveReports);
          setSelectedReport(current => current ? (liveReports.find(report => report.id === current.id) || current) : null);
          if (knownUser?.role === 'admin') {
            try { setDashboard(await api('/dashboard')); }
            catch (error) { setDashboard(null); showToast(`Dashboard metrics unavailable: ${error.message}`); }
            try { setContractors((await api('/contractors')).contractors || []); } catch (_) { setContractors([]); }
          } else {
            setDashboard(null);
          }
          if (knownUser?.role === 'contractor') {
            try { const work = await api('/offers'); setContractorJobs(work.offers || []); setContractorProfile(work.contractor || null); }
            catch (error) { setContractorJobs([]); showToast(`Contractor work unavailable: ${error.message}`); }
          } else { setContractorJobs([]); setContractorProfile(null); }
          if (knownUser) {
            try { setRepairRequests((await api('/repair-requests')).requests || []); }
            catch (error) { setRepairRequests([]); showToast(`Repair records unavailable: ${error.message}`); }
          } else {
            setRepairRequests([]);
          }
        } catch (error) {
          if (authUserRef.current) showToast('Live data is temporarily unavailable. Showing the latest available records.');
        }
      };

      useEffect(() => {
        if (selectedReport?.id) {
          const stored = sessionStorage.getItem(`urbanfix-reporter-${selectedReport.id}`) || '';
          setVerificationToken(stored);
          setCitizenFeedback('');
        }
      }, [selectedReport?.id]);

      const authenticate = async (forcedMode = null) => {
        const selectedMode = ['login', 'register'].includes(forcedMode) ? forcedMode : authMode;
        authVersionRef.current += 1;
        setAuthError('');
        if (selectedMode === 'register' && authForm.password !== authForm.confirmPassword) return setAuthError('Passwords do not match.');
        setAuthBusy(true);
        try {
          const path = selectedMode === 'register' ? '/auth/register' : '/auth/login';
          const payload = selectedMode === 'register' ? {name:authForm.name.trim(),email:authForm.email.trim(),password:authForm.password,phone:authForm.phone.trim(),payout_account_id:authForm.payoutAccount.trim()} : {email:authForm.email.trim(),password:authForm.password};
          const user = await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          window.URBANFIX_CSRF = user.csrf_token; setAuthUser(user); setAuthForm({name:'',email:'',password:'',confirmPassword:'',phone:'',payoutAccount:''});
          await refreshData(user); showToast(`Welcome, ${user.name}.`);
        } catch (error) { setAuthError(error.message); showToast(error.message); }
        finally { setAuthBusy(false); }
      };

      const authenticateContractor = async () => {
        if (authMode === 'register' && authForm.password !== authForm.confirmPassword) return setAuthError('Passwords do not match.');
        setAuthBusy(true); setAuthError(''); authVersionRef.current += 1;
        try {
          const registering = authMode === 'register';
          const payload = registering ? {name:authForm.name.trim(),email:authForm.email.trim(),password:authForm.password,phone:authForm.phone.trim(),account_type:'contractor',service_area:contractorForm.service_area.trim(),skills:contractorForm.skills.split(',').map(v=>v.trim()).filter(Boolean),payout_account_id:contractorForm.payout_account_id.trim()} : {email:authForm.email.trim(),password:authForm.password};
          const user = await api(registering ? '/auth/register' : '/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          if (user.role !== 'contractor') throw new Error('Use a registered contractor account.');
          window.URBANFIX_CSRF=user.csrf_token; setAuthUser(user); await refreshData(user); showToast(`Welcome, ${user.name}.`);
        } catch(error) { setAuthError(error.message); showToast(error.message); }
        finally { setAuthBusy(false); }
      };

      const updateContractorJob = async (offer, status) => {
        const proof = contractorProofs[offer.offer_id] || {};
        if (status === 'Proof Submitted' && (!proof.image || !proof.report_url?.trim() || !proof.note?.trim() || !proof.public_access_confirmed)) return showToast('Add a photo, public Drive report, summary, and confirm link access.');
        try {
          if (status === 'Proof Submitted') {
            const data = new FormData(); data.append('image', proof.image); data.append('report_url', proof.report_url.trim()); data.append('note', proof.note.trim()); data.append('public_access_confirmed', String(proof.public_access_confirmed));
            await api(`/offers/${offer.offer_id}/proof`, {method:'POST', body:data});
          } else {
            await api(`/offers/${offer.offer_id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
          }
          await refreshData(authUser); showToast(status === 'Proof Submitted' ? 'Work submitted for authority verification.' : `Work order ${status.toLowerCase()}.`);
        }
        catch(error) { showToast(error.message); }
      };

      const confirmHumanReview = async form => {
        if (!reviewReport) return;
        setReviewBusy(true);
        try {
          const updated = await api(`/complaints/${reviewReport.id}/override`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({final_category:form.category,final_severity:form.severity,final_department:form.department.trim(),reason:form.reason.trim()})});
          setSelectedReport(normalizeReport(updated)); setReviewReport(null); await refreshData(authUser); showToast(`${reviewReport.id} reviewed and ready for assignment.`);
        } catch (error) { showToast(error.message); }
        finally { setReviewBusy(false); }
      };

      const approveContractor = async (contractor, approved) => {
        try { await api(`/contractors/${contractor.contractor_id}/approval`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({approved})}); await refreshData(authUser); showToast(`Contractor ${approved?'approved':'rejected'}.`); }
        catch(error) { showToast(error.message); }
      };

      const rateContractor = async (report, score) => {
        const authority = authUser?.role === 'admin';
        const token = sessionStorage.getItem(`urbanfix-reporter-${report.id}`);
        if (!authority && !token) return showToast('Only the original reporter or authority can rate this work.');
        try { const updated=await api(`/complaints/${report.id}/${authority?'authority':'reporter'}-contractor-rating`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score,token})}); setSelectedReport(normalizeReport(updated)); await refreshData(authUser); showToast(`${score}-star rating recorded.`); }
        catch(error) { showToast(error.message); }
      };

      const handleDemoOfficerLogin = async (username) => {
        setAuthBusy(true);
        setAuthError('');
        try {
          const user = await api('/auth/demo-officer-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username }),
          });
          if (user.csrf_token) window.URBANFIX_CSRF = user.csrf_token;
          setAuthUser(user);
          await refreshData(user);
          showToast(`Logged in as simulated officer: ${user.name}`);
        } catch (err) {
          setAuthError(err.message);
        } finally {
          setAuthBusy(false);
        }
      };

      const logout = async () => {
        authVersionRef.current += 1;
        try { await api('/auth/logout',{method:'POST'}); } catch (_) {}
        window.URBANFIX_CSRF=''; setAuthUser(null); setDashboard(null); setRepairRequests([]); setOperationDetail(null); setActiveTab('landing'); showToast('Logged out securely.');
      };

      const showToast = (msg) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3500);
      };

      const handlePhotoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) return showToast('Use a JPEG, PNG, WebP, or GIF image.');
        if (file.size > 4 * 1024 * 1024) return showToast('Image must be 4 MB or smaller.');
        setUploadedFile(file);
        setUploadedImage(URL.createObjectURL(file));
        setIsAnalyzing(true);
        setAnalysisComplete(false);
        try {
          const data = new FormData();
          data.append('image', file);
          data.append('description', reportForm.description || 'Civic issue shown in uploaded evidence');
          data.append('category_hint', reportForm.category || 'Let AI decide');
          const analysis = await api('/complaints/analyze', { method: 'POST', body: data });
          if (analysis.is_civic_issue === false && analysis.confidence >= 0.75) {
            setUploadedFile(null);
            setUploadedImage(null);
            setAiAnalysis(null);
            setPhotoLocation(null);
            showToast('This photo does not appear to show a civic issue. Please choose another photo.');
            return;
          }
          setAiAnalysis(analysis);
          setPhotoLocation(analysis.photo_location || null);
          setUploadedImage(absoluteMediaUrl(analysis.image_url) || URL.createObjectURL(file));
          setReportForm(form => ({
            ...form,
            category: analysis.category,
            severity: analysis.severity,
            description: form.description,
          }));
          setReportStep(2);
        } catch (error) {
          setAiAnalysis(null);
          setPhotoLocation(null);
          showToast(`AI analysis unavailable: ${error.message}`);
          setReportStep(2);
        } finally {
          setIsAnalyzing(false);
          setAnalysisComplete(true);
        }
      };

      const handleFinalSubmit = async () => {
        if (!reportForm.location.trim() || !reportForm.description.trim()) return showToast('Location and description are required.');
        if (aiAnalysis?.is_civic_issue === false && aiAnalysis?.confidence >= .75) return showToast('This image does not appear to show a civic issue.');
        setIsSubmitting(true);
        try {
          const data = new FormData();
          data.append('description', reportForm.description);
          data.append('area', reportForm.location);
          data.append('category_hint', reportForm.category);
          data.append('image_quality', uploadedFile ? 'usable' : 'missing');
          if (reportForm.latitude != null) data.append('latitude', reportForm.latitude);
          if (reportForm.longitude != null) data.append('longitude', reportForm.longitude);
          if (reportForm.locationSource) data.append('location_source', reportForm.locationSource);
          data.append('location_confirmed', String(reportForm.locationConfirmed));
          if (reportForm.locationAccuracy != null) data.append('location_accuracy_meters', reportForm.locationAccuracy);
          if (reportForm.photoCapturedAt) data.append('photo_captured_at', reportForm.photoCapturedAt);
          if (reportForm.reporterContact.trim()) data.append('reporter_contact', reportForm.reporterContact.trim());
          if (aiAnalysis?.analysis_token) data.append('analysis_token', aiAnalysis.analysis_token);
          if (uploadedFile) data.append('image', uploadedFile);
          const created = await api('/complaints/with-image', { method: 'POST', headers: {'Idempotency-Key': reportSubmissionKeyRef.current}, body: data });
          const newReport = normalizeReport(created);
          await refreshData();
          setSelectedReport(newReport);
          setTrackingQuery(newReport.id);
          setSubmittedReportId(newReport.id);
          reportSubmissionKeyRef.current = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
          if (created.reporter_verification_token) {
            sessionStorage.setItem(`urbanfix-reporter-${newReport.id}`, created.reporter_verification_token);
          }
          setActiveTab('track');
        } catch (error) {
          showToast(`Submission failed: ${error.message}`);
        } finally { setIsSubmitting(false); }
      };

      const trackById = async () => {
        if (!trackingQuery.trim()) return setTrackingError('Enter a case ID to continue.');
        const complaintId = trackingQuery.trim().toUpperCase().startsWith('CP-')
          ? trackingQuery.trim().toUpperCase()
          : `CP-${trackingQuery.trim().toUpperCase()}`;
        setTrackingBusy(true);
        setTrackingError('');
        try {
          const result = await api(`/track/${encodeURIComponent(complaintId)}`);
          setSubmittedReportId('');
          setSelectedReport(normalizeReport(result.complaint || result));
          showToast('Live tracking record loaded.');
        } catch (error) {
          setTrackingError(error.status === 404 ? 'Case not found. Check the ID and try again.' : error.message);
        } finally { setTrackingBusy(false); }
      };

      const openJudgeDemo = () => {
        const demo = reports.find(report => report.status === 'Resolved' || report.fully_verified) || reports[0];
        if (!demo) return showToast('Demo records are still loading. Please try again.');
        setSubmittedReportId('');
        setTrackingQuery(demo.id);
        setTrackingError('');
        setSelectedReport(demo);
        setActiveTab('track');
      };

      const loadAccountabilityReceipt = async report => {
        try { setAccountabilityReceipt(await api(`/track/${encodeURIComponent(report.id)}/receipt`)); }
        catch (error) { showToast(error.message); }
      };

      const reverseGeocode = async (latitude, longitude, source, extra = {}) => {
        setReportForm(form => ({
          ...form, latitude, longitude, locationSource: source, locationConfirmed: true,
          locationAccuracy: extra.accuracy ?? null,
          photoCapturedAt: extra.capturedAt ?? form.photoCapturedAt,
        }));
        try {
          const place = await api(`/geo/reverse?latitude=${latitude}&longitude=${longitude}`);
          setReportForm(form => ({...form, location: place.display_name, latitude, longitude, locationSource: source, locationConfirmed: true}));
          showToast(`Location found: ${place.area || place.city || place.display_name}`);
        } catch (error) {
          setReportForm(form => ({...form, location: form.location || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}));
          showToast('Coordinates attached; the readable address lookup is unavailable.');
        }
      };

      const usePhotoLocation = () => {
        if (!photoLocation) return;
        reverseGeocode(photoLocation.latitude, photoLocation.longitude, 'photo_exif', {
          accuracy: photoLocation.accuracy_meters,
          capturedAt: photoLocation.captured_at,
        });
      };

      const captureLocation = () => {
        if (!navigator.geolocation) return showToast('GPS is not supported by this device.');
        navigator.geolocation.getCurrentPosition(
          position => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            showToast('GPS captured. Looking up the street address…');
            reverseGeocode(latitude, longitude, 'device_gps', {accuracy: position.coords.accuracy});
          },
          () => showToast('Location permission was not granted.'),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      };

      const selectMapLocation = (latitude, longitude) => {
        reverseGeocode(latitude, longitude, 'map_pin');
      };

      const approveResolution = async (report, stakeholder) => {
        try {
          const updated = await api(`/complaints/${report.id}/resolution-approval`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({stakeholder, approved:true}) });
          setSelectedReport(normalizeReport(updated)); await refreshData(); showToast(`${stakeholder} approval recorded.`);
        } catch (error) { showToast(error.message); }
      };

      const updateStatus = async (report, status) => {
        try {
          const updated = await api(`/complaints/${report.id}/status`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, note: `Status updated from command center to ${status}.` })
          });
          setSelectedReport(normalizeReport(updated));
          await refreshData();
          showToast(`${report.id} moved to ${status}.`);
        } catch (error) { showToast(error.message); }
      };

      const nextOperationalStatus = report => ({
        'Submitted': (report.assigned_authority?.routing_status === 'assigned') ? 'Acknowledged' : 'Assigned',
        'Needs Review': 'Assigned',
        'Assigned': 'Acknowledged',
        'Contractor Offer Sent': 'Acknowledged',
        'Acknowledged': 'In Progress',
        'Reopened - Needs Review': 'Acknowledged',
      })[report.status] || null;

      const inspectIncident = async report => {
        setOperationLoading(true);
        try {
          const detail = await api(`/operations/incidents/${report.id}`);
          setOperationDetail({...detail, complaint: normalizeReport(detail.complaint)});
          setOfferForm({ contractor_id: detail.contractor_matches?.[0]?.contractor_id || '', budget_cap: '', sla_hours: 24 });
          setAdminView('queue');
        } catch (error) { showToast(error.message); }
        finally { setOperationLoading(false); }
      };

      const assignContractor = async () => {
        if (!operationDetail || !offerForm.contractor_id || !offerForm.budget_cap) return showToast('Choose a contractor and enter a budget cap.');
        try {
          await api('/offers', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
            complaint_id: operationDetail.complaint.id,
            contractor_id: offerForm.contractor_id,
            work_type: operationDetail.complaint.category,
            budget_cap: Number(offerForm.budget_cap),
            sla_hours: Number(offerForm.sla_hours),
            proof_required: 'Before/after photograph, GPS location and completion note'
          })});
          await refreshData(); await inspectIncident(operationDetail.complaint); showToast('Work order sent to contractor.');
        } catch (error) { showToast(error.message); }
      };

      const changeOfferStatus = async (offer, status, note = '') => {
        try {
          await api(`/offers/${offer.offer_id}/status`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status,note:note || `Contractor work order marked ${status}.`})});
          await refreshData(authUser); await inspectIncident(operationDetail.complaint); showToast(status === 'Approved' ? 'Final review approved and payment released.' : `Work order ${status}.`);
        } catch (error) { showToast(error.message); }
      };

      const markAffected = async () => {
        try {
          const result = await api(`/complaints/${selectedReport.id}/affected-too`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_fingerprint: `browser-${navigator.language}`, note: 'Community confirmation from public tracking page.' })
          });
          setSelectedReport(normalizeReport(result.complaint));
          await refreshData();
          showToast(result.message);
        } catch (error) { showToast(error.message); }
      };

      const handleCitizenVerify = async (outcome) => {
        const token = (verificationToken || sessionStorage.getItem(`urbanfix-reporter-${selectedReport?.id}`) || '').trim();
        if (!token) {
          showToast('Please enter your reporter verification token to proceed.');
          return;
        }
        if ((outcome === 'not_fixed' || outcome === 'partially_fixed') && !citizenFeedback.trim()) {
          showToast('Please provide a reason or notes for the dispute.');
          return;
        }
        setIsVerifying(true);
        try {
          const updated = await api(`/complaints/${selectedReport.id}/reporter-verification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              outcome,
              note: citizenFeedback.trim() || (outcome === 'fixed' ? 'Citizen verified resolution on site.' : 'Citizen disputed resolution.'),
            }),
          });
          setSelectedReport(normalizeReport(updated));
          await refreshData(authUser);
          showToast(outcome === 'fixed' ? '✓ Resolution confirmed! Complaint is now fully resolved.' : 'Dispute recorded. Complaint reopened for field review.');
          setCitizenFeedback('');
        } catch (error) {
          showToast(error.message || 'Verification failed. Please check token.');
        } finally {
          setIsVerifying(false);
        }
      };

      const handleOfficerStatusUpdate = async (status, note) => {
        if (!operationDetail?.complaint) return;
        try {
          await api(`/complaints/${operationDetail.complaint.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, note }),
          });
          await refreshData(authUser);
          await inspectIncident(operationDetail.complaint);
          showToast(`Status updated to ${status}.`);
        } catch (error) {
          showToast(error.message);
        }
      };

      const handleOfficerProgressUpdate = async () => {
        if (!operationDetail?.complaint || !officerProgressNote.trim()) {
          showToast('Please enter a progress note.');
          return;
        }
        try {
          await api(`/complaints/${operationDetail.complaint.id}/progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: officerProgressNote.trim() }),
          });
          setOfficerProgressNote('');
          await refreshData(authUser);
          await inspectIncident(operationDetail.complaint);
          showToast('Progress update saved.');
        } catch (error) {
          showToast(error.message);
        }
      };

      const handleEvidenceUpload = async () => {
        if (!operationDetail?.complaint || !evidenceFile || !evidenceNote.trim()) {
          showToast('Please select a photo and enter field completion notes.');
          return;
        }
        setIsUploadingEvidence(true);
        try {
          const formData = new FormData();
          formData.append('image', evidenceFile);
          formData.append('completion_note', evidenceNote.trim());
          await api(`/complaints/${operationDetail.complaint.id}/evidence/upload`, {
            method: 'POST',
            body: formData,
          });
          setEvidenceFile(null);
          setEvidenceNote('');
          await refreshData(authUser);
          await inspectIncident(operationDetail.complaint);
          showToast('✓ Resolution evidence uploaded. Submitted for citizen verification.');
        } catch (error) {
          showToast(error.message);
        } finally {
          setIsUploadingEvidence(false);
        }
      };

      const submitRepairRequest = async () => {
        if (!authUser || authUser.role !== 'youth') return showToast('Log in with a youth account first.');
        try {
          const created = await api('/repair-requests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({...repairForm, estimated_price: Number(repairForm.estimated_price), estimated_hours: Number(repairForm.estimated_hours)})
          });
          setRepairForm({ complaint_id: '', estimated_price: '', plan: '', estimated_hours: 24 });
          await refreshData();
          showToast(`Repair request ${created.request_id} sent to the authority.`);
        } catch (error) { showToast(error.message); }
      };

      const decideRepair = async (request, approved) => {
        try {
          await api(`/repair-requests/${request.request_id}/decision`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved, approved_budget: approved ? Number(fundingBudgets[request.request_id] || request.estimated_price) : null, note: approved ? 'Reviewed budget approved and reserved pending proof.' : 'Request declined by authority.' })
          });
          await refreshData(); showToast(approved ? 'Demo budget reservation recorded.' : 'Request rejected.');
        } catch (error) { showToast(error.message); }
      };

      const submitProofFile = async (request, file) => {
        if (!file) return;
        const data = new FormData();
        data.append('image', file);
        data.append('completion_note', `Completion evidence submitted for ${request.request_id}.`);
        try {
          await api(`/repair-requests/${request.request_id}/proof-with-image`, {method:'POST', body:data});
          await refreshData(); showToast('Completion photo uploaded for government verification.');
        } catch (error) { showToast(error.message); }
      };

      const releaseFunds = async (request) => {
        try {
          await api(`/repair-requests/${request.request_id}/release-funds`, { method: 'POST' });
          await refreshData(); showToast('Proof verified, payment approved, and case closed.');
        } catch (error) { showToast(error.message); }
      };

      const reportCategories = [...new Set(reports.map(item => item.category).filter(Boolean))].sort();
      const filteredAdminReports = reports.filter(item => {
        if (authUser?.role === 'officer' && authUser?.authority_id) {
          const itemAuth = item.assigned_authority?.authority_id;
          if (itemAuth && itemAuth !== authUser.authority_id) return false;
        }
        const searchable = `${item.id} ${item.title || ''} ${item.description || ''} ${item.category} ${item.location} ${item.status}`.toLowerCase();
        if (searchQuery && !searchable.includes(searchQuery.toLowerCase())) return false;
        if (queueFilters.category !== 'all' && item.category !== queueFilters.category) return false;
        if (queueFilters.severity !== 'all' && item.severity !== queueFilters.severity) return false;
        if (queueFilters.state === 'assigned' && !['Assigned','In Progress','Evidence Uploaded'].includes(item.status)) return false;
        if (queueFilters.state === 'unresolved' && item.status === 'Resolved') return false;
        if (queueFilters.state === 'resolved' && item.status !== 'Resolved') return false;
        if (queueFilters.state === 'needs_action' && !['Submitted','Needs Review'].includes(item.status)) return false;
        if (queueFilters.days !== 'all') {
          const reported = new Date(item.created_at || item.reportedAt || 0);
          if (!reported.getTime() || reported < new Date(Date.now() - Number(queueFilters.days) * 86400000)) return false;
        }
        return true;
      }).sort((a,b) => {
        if (queueFilters.sort === 'oldest') return new Date(a.created_at || a.reportedAt || 0) - new Date(b.created_at || b.reportedAt || 0);
        if (queueFilters.sort === 'newest') return new Date(b.created_at || b.reportedAt || 0) - new Date(a.created_at || a.reportedAt || 0);
        return Number(b.priority_score || 0) - Number(a.priority_score || 0);
      });

      const resetQueueFilters = () => {
        setSearchQuery('');
        setQueueFilters({days:'all',state:'unresolved',category:'all',severity:'all',sort:'priority'});
      };

      const displayedAdminReports = adminView === 'review'
        ? filteredAdminReports.filter(item => item.needs_review || item.status === 'Needs Review')
        : adminView === 'proofs'
          ? filteredAdminReports.filter(item => item.status === 'Evidence Uploaded')
          : filteredAdminReports;

      const featuredReport = reports[0];

      return (
        <div className="min-h-screen flex flex-col bg-surface font-sans text-ink-primary transition-colors duration-200">
          <a href="#main-content" className="skip-link">Skip to main content</a>

          {/* TOP MUNICIPAL SERVICE TICKER RIBBON */}
          <div className="w-full bg-emerald-950 text-emerald-100 border-b border-emerald-900 py-1.5 px-4 overflow-hidden whitespace-nowrap">
            <div className="max-w-7xl mx-auto flex items-center justify-between text-xs font-sans">
              <div className="inline-flex items-center gap-4 sm:gap-6 overflow-hidden">
                <span className="flex items-center gap-2 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shadow-[0_0_8px_#34D399]"></span>
                  <span>{t.tickerStatus}</span>
                </span>
                <span className="text-emerald-700">|</span>
                <span className="text-emerald-300 font-semibold hidden md:inline">{t.tickerPill1}</span>
                <span className="text-emerald-700 hidden md:inline">|</span>
                <span className="hidden sm:inline">{t.tickerPill2}</span>
                <span className="text-emerald-700 hidden sm:inline">|</span>
                <span className="text-amber-300 font-medium">{t.tickerPill3} {reports.length}</span>
              </div>
              <div className="hidden lg:flex items-center gap-3 text-emerald-200 text-[11px] font-medium">
                <span>🏛️ {t.tickerPill4}</span>
              </div>
            </div>
          </div>

          {/* HEADER / NAVIGATION */}
          <header className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
            <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between gap-6">
              <div className="flex items-center gap-4 lg:gap-6">
                <button aria-label="UrbanFix home" className="flex shrink-0 items-center gap-2.5 text-left focus:outline-none cursor-pointer" onClick={() => setActiveTab('landing')}>
                  <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm">
                    <Icon name="check" className="w-5 h-5 text-white stroke-[3]" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-headline font-bold text-lg tracking-tight text-slate-900 dark:text-white leading-none">UrbanFix BD</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">{lang === 'bn' ? 'ডিজিটাল পৌর নাগরিক প্ল্যাটফর্ম' : 'Municipal Civic Portal'}</span>
                  </div>
                </button>
                <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10B981]"></span>
                  <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">{lang === 'bn' ? 'লাইভ পৌর নেটওয়ার্ক' : 'Live Civic Sync'}</span>
                </div>
              </div>

              <nav className="hidden md:flex items-center gap-1.5 lg:gap-2 text-xs font-semibold">
                {[
                  { id: 'landing', label: t.home, enLabel: 'Home' },
                  { id: 'report', label: t.reportIssue, enLabel: 'Report Issue' },
                  { id: 'track', label: t.trackReport, enLabel: 'Track Report' },
                  { id: 'map', label: t.publicMap, enLabel: 'Public Map' },
                ].map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { if (tab.id === 'track') { setSelectedReport(null); setSubmittedReportId(''); } setActiveTab(tab.id); }}
                      aria-label={tab.enLabel}
                      aria-current={isActive ? 'page' : undefined}
                      className={`px-4 py-2 rounded-xl transition-all cursor-pointer ${
                        isActive 
                          ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800 shadow-sm'
                          : 'border border-transparent text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
                {/* BILINGUAL LANGUAGE TOGGLE (বাংলা / EN) */}
                <button 
                  onClick={() => setLang(l => l === 'bn' ? 'en' : 'bn')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 text-xs font-bold shadow-sm hover:border-emerald-500 transition-all cursor-pointer"
                  title="Switch Language / ভাষা পরিবর্তন করুন"
                  aria-label="Language Toggle"
                >
                  <span className={lang === 'bn' ? 'text-emerald-700 dark:text-emerald-400 font-black' : 'text-slate-400 font-normal'}>বাং</span>
                  <span className="text-slate-300 dark:text-slate-600 font-normal">|</span>
                  <span className={lang === 'en' ? 'text-emerald-700 dark:text-emerald-400 font-black' : 'text-slate-400 font-normal'}>EN</span>
                </button>

                {/* THEME TOGGLE */}
                <button 
                  onClick={() => setDarkMode(value => !value)} 
                  aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} 
                  title={`Switch to ${darkMode ? 'light' : 'dark'} mode`} 
                  className="w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center shadow-sm transition-colors cursor-pointer"
                >
                  <Icon name={darkMode ? 'sun' : 'moon'} className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </button>

                {/* AUTHORITY PORTAL BUTTON */}
                <button 
                  onClick={() => setActiveTab('admin')}
                  aria-label="Authority Portal"
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-2 cursor-pointer shadow-sm ${
                    activeTab === 'admin'
                      ? 'bg-emerald-600 text-white font-bold border-emerald-700'
                      : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'
                  }`}
                >
                  <Icon name="shield-alert" className="w-4 h-4 text-emerald-400" />
                  <span className="hidden sm:inline">{t.authorityPortal}</span>
                </button>
              </div>
            </div>
          </header>

          {/* MOBILE BOTTOM NAVIGATION */}
          <nav aria-label="Mobile navigation" className="mobile-nav lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-2 py-1.5 grid grid-cols-4 shadow-lg">
            {[
              ['landing','home','Home'], ['report','camera','Report'], ['track','search','Track'],
              ['map','map','Map']
            ].map(([id, icon, label]) => {
              const isActive = activeTab === id;
              return (
                <button 
                  key={id} 
                  aria-current={isActive ? 'page' : undefined} 
                  onClick={() => { if (id === 'track') { setSelectedReport(null); setSubmittedReportId(''); } setActiveTab(id); }}
                  className={`min-w-0 min-h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-semibold transition-all ${
                    isActive ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-bold' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Icon name={icon} className="w-4 h-4"/>
                  <span className="truncate w-full text-center tracking-tight">{label}</span>
                </button>
              );
            })}
          </nav>

          {/* TOAST NOTIFICATION */}
          {toast && (
            <div role="status" aria-live="polite" className="fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50">
              <div className="bg-slate-900 text-white dark:bg-slate-800 dark:text-slate-100 border border-slate-700 dark:border-slate-600 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3">
                <Icon name="activity" className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs font-medium leading-snug">{toast}</span>
              </div>
            </div>
          )}

          {/* MAIN BODY ROUTING */}
          <main id="main-content" className="flex-1" tabIndex="-1">
            {/* 1. LANDING PAGE (GovTech Civic Trust Design System) */}
            {activeTab === 'landing' && (
              <div className="flex flex-col w-full">
                {/* HERO SECTION */}
                <section aria-labelledby="hero-title" className="w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-12 md:py-20 transition-colors">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                      {/* Left Column: Primary Messaging & Trigger Actions */}
                      <div className="lg:col-span-7 flex flex-col justify-between">
                        <div className="flex flex-col">
                          {/* Official Republic Badge */}
                          <div className="inline-flex items-center gap-2 self-start bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 px-3.5 py-1.5 rounded-full text-xs font-semibold text-emerald-800 dark:text-emerald-300 shadow-sm mb-5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>🏛️ {t.govBadge}</span>
                          </div>

                          {/* Massive Punchy Headline */}
                          <h1 id="hero-title" className="font-headline text-3xl sm:text-5xl lg:text-5xl font-black text-slate-900 dark:text-white tracking-tight leading-[1.2] mb-4">
                            {t.heroTitle1}<br/>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {t.heroTitle2}
                            </span>
                          </h1>

                          {/* Subtext */}
                          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-xl mb-7 leading-relaxed font-normal">
                            {t.heroSubtext}
                          </p>

                          {/* Action CTAs: GovTech Primary & Secondary Buttons */}
                          <div className="flex flex-wrap items-center gap-3.5 mb-8">
                            <button 
                              onClick={() => { setReportStep(1); setActiveTab('report'); }}
                              aria-label="Report an Issue"
                              className="inline-flex items-center justify-center gap-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-sm sm:text-base px-6 py-3.5 rounded-xl shadow-md hover:shadow-lg transition-all cursor-pointer" 
                              data-path="report-issue"
                            >
                              <Icon name="camera" className="w-5 h-5 text-white" />
                              <span>{t.reportBtn} →</span>
                            </button>
                            <button 
                              onClick={() => { setSelectedReport(null); setTrackingError(''); setActiveTab('track'); }}
                              aria-label="Track a Report"
                              className="inline-flex items-center justify-center gap-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 active:bg-slate-100 text-slate-800 dark:text-slate-100 font-semibold text-sm sm:text-base border border-slate-300 dark:border-slate-700 px-6 py-3.5 rounded-xl shadow-sm hover:shadow transition-all cursor-pointer" 
                              data-path="track-report"
                            >
                              <Icon name="search" className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                              <span>{t.trackBtn}</span>
                            </button>
                          </div>

                          {/* Trust / Value Proposition Checklist */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-xs font-bold">✓</div>
                              <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{t.check1}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-xs font-bold">✓</div>
                              <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{t.check2}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-xs font-bold">✓</div>
                              <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">{t.check3}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Featured Public Report Card */}
                      <div className="lg:col-span-5 w-full">
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden flex flex-col relative transition-all">
                          {/* Card Header Ribbon */}
                          <div className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 px-5 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon name="globe" className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{lang === 'bn' ? 'সাম্প্রতিক নাগরিক রিপোর্ট' : 'Recent Public Report'}</span>
                            </div>
                            <span className="bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold px-2.5 py-0.5 rounded-full">
                              {lang === 'bn' ? 'সরাসরি পর্যবেক্ষণ' : 'Live Incident'}
                            </span>
                          </div>

                          {/* Card Visual Evidence / Image container */}
                          <div className="relative h-52 bg-slate-100 dark:bg-slate-900 overflow-hidden group">
                            <img 
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                              alt="Civic report evidence"
                              src={featuredReport?.beforeImage || featuredReport?.image_url || "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800"} 
                            />
                            <div className="absolute bottom-2 left-2 bg-slate-900/85 text-white px-2.5 py-1 rounded-lg text-[10px] font-mono flex items-center gap-1.5 backdrop-blur-sm">
                              <Icon name="camera" className="w-3.5 h-3.5 text-emerald-400" />
                              <span>PHOTO-LOG #{featuredReport?.id || '4092-B'}</span>
                            </div>
                          </div>

                          {/* Incident Details */}
                          <div className="p-5 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              {/* Status Pill */}
                              <div className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 rounded-full">
                                <span className={`w-2 h-2 rounded-full ${featuredReport?.status === 'Resolved' ? 'bg-emerald-500 shadow-[0_0_6px_#10B981]' : 'bg-amber-500 animate-ping'}`}></span>
                                <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">{featuredReport?.status || 'In Progress'}</span>
                              </div>
                              <span className="text-[11px] text-slate-400 font-medium">{lang === 'bn' ? 'আজকের আপডেট' : 'Updated recently'}</span>
                            </div>

                            {/* Incident Title and Description */}
                            <h2 className="font-headline text-sm font-bold text-slate-900 dark:text-white leading-snug line-clamp-2">
                              {featuredReport?.title || 'Severe waterlogging and overflow along Muradpur main road following morning rainfall.'}
                            </h2>

                            {/* Location Tag Meta */}
                            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-700/50 px-3 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300">
                              <Icon name="map-pin" className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <span className="font-medium truncate">
                                {featuredReport?.location || 'Muradpur Junction, Ward 08'}
                              </span>
                            </div>

                            {/* Metadata Key-Value Spec Grid */}
                            <div className="grid grid-cols-2 gap-2 border-t border-slate-200 dark:border-slate-700 pt-2.5 text-[11px]">
                              <div>
                                <span className="text-slate-400 block text-[10px]">{lang === 'bn' ? 'অভিযোগ নং:' : 'Report ID:'}</span>
                                <span className="font-bold font-mono text-slate-800 dark:text-slate-200">#{featuredReport?.id || 'UF-2026-0841'}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block text-[10px]">{lang === 'bn' ? 'দায়িত্বপ্রাপ্ত দপ্তর:' : 'Assigned Dept:'}</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">{featuredReport?.department || 'Road Maintenance'}</span>
                              </div>
                            </div>

                            {/* Card Action Button */}
                            <div className="mt-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                              <button 
                                onClick={() => setActiveTab('map')} 
                                className="w-full flex items-center justify-between bg-emerald-50 dark:bg-slate-700/60 hover:bg-emerald-600 hover:text-white text-emerald-800 dark:text-emerald-300 px-3.5 py-2 rounded-xl transition-colors text-xs font-semibold cursor-pointer"
                              >
                                <span>{lang === 'bn' ? 'সকল উন্মুক্ত রিপোর্ট দেখুন' : 'View all public reports'}</span>
                                <Icon name="arrow-right" className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* QUICK CITIZEN ISSUE CATEGORIES */}
                <section className="w-full bg-slate-50 dark:bg-slate-900/50 py-12 md:py-16 border-b border-slate-200 dark:border-slate-800 transition-colors">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="max-w-2xl mb-8">
                      <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                        {t.categoriesBadge}
                      </div>
                      <h2 className="font-headline text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                        {t.categoriesTitle}
                      </h2>
                      <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                        {t.categoriesSub}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[
                        {
                          title: t.catRoadsTitle,
                          desc: t.catRoadsSub,
                          icon: 'hammer',
                          color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                          cat: 'Road Infrastructure'
                        },
                        {
                          title: t.catDrainageTitle,
                          desc: t.catDrainageSub,
                          icon: 'droplets',
                          color: 'bg-blue-50 text-blue-700 border-blue-200',
                          cat: 'Drainage & Sewerage'
                        },
                        {
                          title: t.catWasteTitle,
                          desc: t.catWasteSub,
                          icon: 'trash-2',
                          color: 'bg-amber-50 text-amber-700 border-amber-200',
                          cat: 'Waste Management'
                        },
                        {
                          title: t.catLightsTitle,
                          desc: t.catLightsSub,
                          icon: 'zap',
                          color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                          cat: 'Street Lighting'
                        }
                      ].map((item, idx) => (
                        <div 
                          key={idx}
                          onClick={() => {
                            setReportForm(prev => ({ ...prev, category: item.cat }));
                            setReportStep(1);
                            setActiveTab('report');
                          }}
                          className="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-emerald-500 dark:hover:border-emerald-500 transition-all cursor-pointer flex flex-col justify-between group"
                        >
                          <div>
                            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-3 group-hover:scale-110 transition-transform">
                              <Icon name={item.icon} className="w-5 h-5" />
                            </div>
                            <h3 className="font-headline font-bold text-base text-slate-900 dark:text-white mb-1 group-hover:text-emerald-600 transition-colors">
                              {item.title}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                              {item.desc}
                            </p>
                          </div>
                          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            <span>{lang === 'bn' ? 'অভিযোগ করুন' : 'Report Now'}</span>
                            <span className="group-hover:translate-x-1 transition-transform">→</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                {/* "HOW IT WORKS" 3-STEP PROCESS SECTION */}
                <section aria-labelledby="workflow-title" className="w-full bg-[#050B14] py-14 md:py-20 text-white border-y border-slate-800 transition-colors">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    {/* Section Header */}
                    <div className="max-w-2xl mb-8">
                      <h2 id="workflow-title" className="font-headline text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-2">
                        {t.howItWorksTitle}
                      </h2>
                      <p className="text-sm sm:text-base text-slate-400">
                        {t.howItWorksSub}
                      </p>
                    </div>

                    {/* Unified 3-Column Box Container Matching Reference Image */}
                    <div className="border border-[#1E293B] rounded-xl overflow-hidden bg-[#0A101D] shadow-2xl">
                      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#1E293B]">
                        {/* Step 01: Report */}
                        <div className="p-6 md:p-8 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between mb-6">
                              <span className="font-headline text-3xl sm:text-4xl font-black text-[#38BDF8] select-none tracking-tight">
                                {t.step1Num || '01'}
                              </span>
                              <div className="w-10 h-10 rounded-md bg-[#0C243C] border border-[#0284C7]/60 flex items-center justify-center text-[#38BDF8]">
                                <Icon name="camera" className="w-5 h-5" />
                              </div>
                            </div>
                            <h3 className="font-headline text-xl font-bold text-white mb-2">
                              {t.step1Title}
                            </h3>
                            <p className="text-sm text-slate-400 leading-relaxed font-normal">
                              {t.step1Desc}
                            </p>
                          </div>
                          <div className="mt-8 pt-4 border-t border-[#1E293B] flex items-center gap-2">
                            <span className="w-2 h-2 bg-[#38BDF8] inline-block flex-shrink-0"></span>
                            <span className="font-mono text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              {t.step1Meta}
                            </span>
                          </div>
                        </div>

                        {/* Step 02: Track */}
                        <div className="p-6 md:p-8 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between mb-6">
                              <span className="font-headline text-3xl sm:text-4xl font-black text-white select-none tracking-tight">
                                {t.step2Num || '02'}
                              </span>
                              <div className="w-10 h-10 rounded-md bg-[#131D2D] border border-[#223247] flex items-center justify-center text-[#38BDF8]">
                                <Icon name="search" className="w-5 h-5" />
                              </div>
                            </div>
                            <h3 className="font-headline text-xl font-bold text-white mb-2">
                              {t.step2Title}
                            </h3>
                            <p className="text-sm text-slate-400 leading-relaxed font-normal">
                              {t.step2Desc}
                            </p>
                          </div>
                          <div className="mt-8 pt-4 border-t border-[#1E293B] flex items-center gap-2">
                            <span className="w-2 h-2 bg-[#38BDF8] inline-block flex-shrink-0"></span>
                            <span className="font-mono text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              {t.step2Meta}
                            </span>
                          </div>
                        </div>

                        {/* Step 03: Verify */}
                        <div className="p-6 md:p-8 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between mb-6">
                              <span className="font-headline text-3xl sm:text-4xl font-black text-[#10B981] select-none tracking-tight">
                                {t.step3Num || '03'}
                              </span>
                              <div className="w-10 h-10 rounded-md bg-[#082820] border border-[#059669]/60 flex items-center justify-center text-[#10B981]">
                                <Icon name="check" className="w-5 h-5" />
                              </div>
                            </div>
                            <h3 className="font-headline text-xl font-bold text-white mb-2">
                              {t.step3Title}
                            </h3>
                            <p className="text-sm text-slate-400 leading-relaxed font-normal">
                              {t.step3Desc}
                            </p>
                          </div>
                          <div className="mt-8 pt-4 border-t border-[#1E293B] flex items-center gap-2">
                            <span className="w-2 h-2 bg-[#10B981] inline-block flex-shrink-0"></span>
                            <span className="font-mono text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              {t.step3Meta}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* LIVE PERFORMANCE METRICS STRIP (Contiguous Cadastre Box Container) */}
                <section className="w-full bg-[#030712] py-12 md:py-16 border-b border-slate-800 transition-colors">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="border border-[#1E293B] rounded-2xl overflow-hidden bg-[#0A101D] shadow-2xl">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#1E293B]">
                        {/* Metric 01: Total Logged */}
                        <div className="p-6 sm:p-8 flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-4">
                              <span className="font-headline text-3xl sm:text-4xl font-black text-white select-none tracking-tight">
                                {t.metric1Val}
                              </span>
                              <div className="w-10 h-10 rounded-md bg-[#131D2D] border border-[#223247] flex items-center justify-center text-[#38BDF8]">
                                <Icon name="inbox" className="w-5 h-5" />
                              </div>
                            </div>
                            <h3 className="font-headline text-lg font-bold text-white mb-2 tracking-tight">
                              {t.metric1Label}
                            </h3>
                            <p className="text-xs text-slate-400 leading-relaxed font-normal">
                              {t.metric1Desc}
                            </p>
                          </div>
                          <div className="mt-6 pt-4 border-t border-[#1E293B] flex items-center gap-2">
                            <span className="w-2 h-2 rounded-[2px] bg-[#38BDF8] inline-block flex-shrink-0"></span>
                            <span className="font-mono text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              {t.metric1Meta}
                            </span>
                          </div>
                        </div>

                        {/* Metric 02: Resolution Rate */}
                        <div className="p-6 sm:p-8 flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-4">
                              <span className="font-headline text-3xl sm:text-4xl font-black text-[#10B981] select-none tracking-tight">
                                {t.metric2Val}
                              </span>
                              <div className="w-10 h-10 rounded-md bg-[#082820] border border-[#059669]/60 flex items-center justify-center text-[#10B981]">
                                <Icon name="check-circle" className="w-5 h-5" />
                              </div>
                            </div>
                            <h3 className="font-headline text-lg font-bold text-white mb-2 tracking-tight">
                              {t.metric2Label}
                            </h3>
                            <p className="text-xs text-slate-400 leading-relaxed font-normal">
                              {t.metric2Desc}
                            </p>
                          </div>
                          <div className="mt-6 pt-4 border-t border-[#1E293B] flex items-center gap-2">
                            <span className="w-2 h-2 rounded-[2px] bg-[#10B981] inline-block flex-shrink-0"></span>
                            <span className="font-mono text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              {t.metric2Meta}
                            </span>
                          </div>
                        </div>

                        {/* Metric 03: Avg Dispatch Turn */}
                        <div className="p-6 sm:p-8 flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-4">
                              <span className="font-headline text-3xl sm:text-4xl font-black text-[#F59E0B] select-none tracking-tight">
                                {t.metric3Val}
                              </span>
                              <div className="w-10 h-10 rounded-md bg-[#241B08] border border-[#D97706]/60 flex items-center justify-center text-[#F59E0B]">
                                <Icon name="clock" className="w-5 h-5" />
                              </div>
                            </div>
                            <h3 className="font-headline text-lg font-bold text-white mb-2 tracking-tight">
                              {t.metric3Label}
                            </h3>
                            <p className="text-xs text-slate-400 leading-relaxed font-normal">
                              {t.metric3Desc}
                            </p>
                          </div>
                          <div className="mt-6 pt-4 border-t border-[#1E293B] flex items-center gap-2">
                            <span className="w-2 h-2 rounded-[2px] bg-[#F59E0B] inline-block flex-shrink-0"></span>
                            <span className="font-mono text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              {t.metric3Meta}
                            </span>
                          </div>
                        </div>

                        {/* Metric 04: Open Transparency */}
                        <div className="p-6 sm:p-8 flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-4">
                              <span className="font-headline text-3xl sm:text-4xl font-black text-[#38BDF8] select-none tracking-tight">
                                {t.metric4Val}
                              </span>
                              <div className="w-10 h-10 rounded-md bg-[#0C243C] border border-[#0284C7]/60 flex items-center justify-center text-[#38BDF8]">
                                <Icon name="shield-check" className="w-5 h-5" />
                              </div>
                            </div>
                            <h3 className="font-headline text-lg font-bold text-white mb-2 tracking-tight">
                              {t.metric4Label}
                            </h3>
                            <p className="text-xs text-slate-400 leading-relaxed font-normal">
                              {t.metric4Desc}
                            </p>
                          </div>
                          <div className="mt-6 pt-4 border-t border-[#1E293B] flex items-center gap-2">
                            <span className="w-2 h-2 rounded-[2px] bg-[#38BDF8] inline-block flex-shrink-0"></span>
                            <span className="font-mono text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                              {t.metric4Meta}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* INTERACTIVE BEFORE/AFTER SHOWCASE */}
                <section className="w-full bg-white dark:bg-slate-900 py-12 md:py-16 border-b border-slate-200 dark:border-slate-800 transition-colors">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 sm:p-10 shadow-sm">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                        <div>
                          <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                            {t.sliderBadge}
                          </div>
                          <h2 className="font-headline text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                            {t.sliderTitle}
                          </h2>
                          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                            {t.sliderSub}
                          </p>
                        </div>
                        <div className="inline-flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-3.5 py-1.5 rounded-full text-xs font-bold text-emerald-800 dark:text-emerald-300 self-start md:self-auto shadow-sm">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          <span>{t.sliderTag}</span>
                        </div>
                      </div>

                      <InteractiveBeforeAfter
                        beforeImage={featuredReport?.beforeImage || "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800"}
                        afterImage={featuredReport?.afterImage || "https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&q=80&w=800"}
                        altBefore="Original reported defect"
                        altAfter="Verified municipal repair"
                      />
                    </div>
                  </div>
                </section>

                {/* EMERGENCY CALLOUT & DIRECT CITIZEN DISPATCH BANNER */}
                <section className="w-full bg-slate-50 dark:bg-slate-900/50 py-12 md:py-16 transition-colors">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="bg-gradient-to-r from-emerald-700 to-teal-800 text-white rounded-3xl p-7 sm:p-10 shadow-lg flex flex-col md:flex-row items-center justify-between gap-6">
                      <div className="flex flex-col max-w-xl text-left">
                        <div className="inline-flex items-center gap-2 text-emerald-200 text-xs uppercase font-bold tracking-wider mb-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-300 animate-pulse"></span>
                          <span>{lang === 'bn' ? 'জরুরি পৌর সাহায্য' : 'URGENT CITIZEN HOTLINE'}</span>
                        </div>
                        <h2 className="font-headline text-xl sm:text-2xl font-black tracking-tight mb-2">
                          {t.bannerTitle}
                        </h2>
                        <p className="text-sm text-emerald-100 font-normal leading-relaxed">
                          {t.bannerSub}
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto shrink-0">
                        <div className="flex items-center justify-center gap-2 bg-emerald-900/70 border border-emerald-500/50 px-4 py-3 rounded-xl text-xs sm:text-sm font-bold text-white shadow-sm">
                          <span className="material-symbols-outlined text-lg text-amber-300">call</span>
                          <span>{t.hotline}</span>
                        </div>
                        <button 
                          onClick={() => { setReportStep(1); setActiveTab('report'); }} 
                          className="flex items-center justify-center gap-2 bg-white text-emerald-800 hover:bg-emerald-50 px-6 py-3 rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all cursor-pointer"
                        >
                          <span>{t.bannerBtn}</span>
                          <Icon name="arrow-right" className="w-4 h-4 text-emerald-800" />
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* 2. CITIZEN REPORT FLOW */}
            {activeTab === 'report' && (
              <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
                {/* STEPPER HEADER */}
                <div className="mb-8 border-b border-slate-200 dark:border-slate-800 pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">Report a Civic Problem</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Add a photo, location, and a short description.</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {[
                      { step: 1, label: 'Photo' },
                      { step: 2, label: 'Details' },
                      { step: 3, label: 'Done' }
                    ].map((s, idx) => (
                      <React.Fragment key={s.step}>
                        <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border transition-all ${
                          reportStep === s.step 
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 font-bold'
                            : reportStep > s.step 
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-600 font-semibold' 
                            : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400'
                        }`}>
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${reportStep >= s.step ? 'bg-emerald-600 text-white' : 'bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                            {reportStep > s.step ? '✓' : s.step}
                          </span>
                          <span className="hidden sm:inline">{s.label}</span>
                        </div>
                        {idx < 2 && <span className="text-slate-400 text-xs">→</span>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* STEP 1: PHOTO EVIDENCE INTAKE */}
                {reportStep === 1 && (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 sm:p-10 text-center reveal-up">
                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-2xl p-8 sm:p-14 transition-all flex flex-col items-center justify-center space-y-5 bg-slate-50/50 dark:bg-slate-900/30">
                      <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <Icon name="camera" className="w-8 h-8" />
                      </div>
                      <div className="max-w-md">
                        <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Add a photo of the problem</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                          A clear photo helps the responsible team understand what needs fixing and automatically pinpoints location when available.
                        </p>
                      </div>
                      
                      <div className="flex flex-col items-center gap-3 w-full sm:w-auto">
                        <label className="cursor-pointer w-full sm:w-auto px-8 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-all flex items-center justify-center gap-2">
                          <Icon name="upload-cloud" className="w-4 h-4 text-white" />
                          <span>{isAnalyzing ? 'Checking photo…' : 'Select or Take Photo'}</span>
                          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handlePhotoUpload} disabled={isAnalyzing} className="hidden" />
                        </label>
                        <button 
                          type="button" 
                          onClick={() => {
                            setUploadedFile(null);
                            setUploadedImage(null);
                            setAiAnalysis(null);
                            setPhotoLocation(null);
                            setAnalysisComplete(true);
                            setReportStep(2);
                          }} 
                          className="text-xs text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 underline underline-offset-4 transition-colors pt-1"
                        >
                          I cannot add a photo
                        </button>
                      </div>

                      <div className="text-xs text-slate-400 pt-2 font-mono">
                        JPEG, PNG or WebP · Up to 4 MB
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 2: REPORT DETAILS */}
                {reportStep === 2 && (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 sm:p-10 space-y-8 reveal-up">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                      {/* EVIDENCE PREVIEW / SCANNER */}
                      <div>
                        <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                          <span>Photo preview</span>
                          {uploadedImage && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">● Usable photo</span>}
                        </div>
                        {uploadedImage ? (
                          <div className="ai-laser-container relative w-full h-64 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950">
                            <img src={uploadedImage} alt="Report preview" className="w-full h-full object-cover" />
                            {isAnalyzing && (
                              <>
                                <div className="ai-laser-beam"></div>
                                <div className="ai-laser-grid"></div>
                                <div className="absolute bottom-3 inset-x-3 z-30 bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-xl p-3 text-center shadow-lg">
                                  <div className="text-xs font-semibold text-emerald-400 flex items-center justify-center gap-2">
                                    <Icon name="scan" className="w-4 h-4 text-emerald-400 animate-spin" />
                                    Analyzing civic evidence…
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-64 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-900/40 p-6 text-center">
                            <Icon name="image-off" className="w-8 h-8 text-slate-400 mb-2" />
                            <span>No photo supplied</span>
                            <span className="text-[10px] text-slate-400 mt-1">Incident will be logged for authority inspection</span>
                          </div>
                        )}
                      </div>

                      {/* AI ASSESSMENT SIGNALS */}
                      <div className="flex flex-col justify-between space-y-4">
                        {isAnalyzing ? (
                          <div className="h-64 flex flex-col items-center justify-center space-y-4 py-8 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl">
                            <Icon name="scan" className="w-8 h-8 text-emerald-600 dark:text-emerald-400 animate-spin" />
                            <div className="text-center px-4">
                              <div className="text-sm font-bold text-slate-900 dark:text-white">Checking your photo</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">We are identifying the type of civic problem.</div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                            <div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                                    <Icon name="sparkles" className="w-3.5 h-3.5 text-emerald-500" />
                                    <span>Suggested description (AI-generated)</span>
                                  </div>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    Draft based on visual recognition. You can customize below.
                                  </p>
                                </div>
                                {aiAnalysis?.summary ? (
                                  <button
                                    type="button"
                                    onClick={() => setReportForm(form => ({ ...form, description: aiAnalysis.summary }))}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 transition-colors flex items-center gap-1.5"
                                  >
                                    <Icon name="sparkles" className="w-3.5 h-3.5" />
                                    <span>Use this suggestion</span>
                                  </button>
                                ) : null}
                              </div>
                              <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 mt-2.5 leading-relaxed bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                                {aiAnalysis?.summary || 'Your photo is ready. Add the location and a short description below.'}
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-xs pt-1">
                              <div>
                                <span className="text-slate-500 dark:text-slate-400 block font-medium">Issue type</span>
                                <span className="text-slate-900 dark:text-white font-bold truncate block mt-0.5">{aiAnalysis?.category || reportForm.category}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 dark:text-slate-400 block font-medium">Urgency</span>
                                <span className={`font-bold block mt-0.5 ${
                                  (aiAnalysis?.severity || reportForm.severity) === 'Critical' ? 'text-red-500' : 'text-amber-500'
                                }`}>
                                  {aiAnalysis?.severity || reportForm.severity}
                                </span>
                              </div>
                            </div>

                            {aiAnalysis?.is_civic_issue === false && (
                              <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                                <Icon name="alert-triangle" className="w-4 h-4 text-amber-500 shrink-0" />
                                <span>
                                  {aiAnalysis?.visual_verification === 'unverified'
                                    ? 'AI visual verification is currently unavailable. Your report will be routed to municipal officers for human review.'
                                    : 'AI could not verify a civic issue in this photo with high confidence. You may describe it below for officer review.'}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {analysisComplete && (
                      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 space-y-5">
                        {/* PHOTO LOCATION DETECTED BANNER */}
                        {photoLocation && (aiAnalysis?.is_civic_issue !== false || aiAnalysis?.confidence < 0.75) && (
                          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                            <div>
                              <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-mono">
                                <Icon name="map-pin" className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                Location found in photo
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 font-mono">
                                {photoLocation.latitude.toFixed(5)}, {photoLocation.longitude.toFixed(5)}
                                {photoLocation.captured_at ? ` · Captured ${new Date(photoLocation.captured_at).toLocaleTimeString()}` : ''}
                              </div>
                            </div>
                            <button 
                              type="button" 
                              onClick={usePhotoLocation} 
                              className="shrink-0 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all"
                            >
                              Use this location
                            </button>
                          </div>
                        )}

                        {/* LOCATION PICKER & ADDRESS INPUT */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            Where is the problem? <span className="text-emerald-600">*</span>
                          </label>
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 px-3.5 py-2.5 text-sm focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500">
                            <Icon name="map-pin" className="w-4 h-4 text-emerald-600 shrink-0" />
                            <input 
                              type="text" 
                              value={reportForm.location}
                              placeholder="Enter street, area or landmark"
                              onChange={(e) => setReportForm({...reportForm, location: e.target.value, locationSource: reportForm.latitude == null ? 'manual' : reportForm.locationSource, locationConfirmed: true})}
                              className="bg-transparent text-slate-900 dark:text-white focus:outline-none w-full text-xs sm:text-sm placeholder-slate-400"
                            />
                            <button 
                              type="button" 
                              onClick={captureLocation} 
                              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                reportForm.locationSource === 'device_gps' ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-emerald-500'
                              }`}
                            >
                              {reportForm.locationSource === 'device_gps' ? '✓ Location added' : 'Use my location'}
                            </button>
                          </div>

                          <div className="flex items-center justify-between mt-2">
                            <button 
                              type="button" 
                              onClick={() => setShowLocationMap(value => !value)} 
                              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-semibold flex items-center gap-1 transition-colors"
                            >
                              <Icon name={showLocationMap ? 'chevron-up' : 'map'} className="w-3.5 h-3.5" />
                              {showLocationMap ? 'Hide map' : 'Choose on map'}
                            </button>
                            {reportForm.locationSource && (
                              <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                                Location added
                              </span>
                            )}
                          </div>

                          {showLocationMap && (
                            <div className="mt-3 reveal-up">
                              <LocationPicker latitude={reportForm.latitude} longitude={reportForm.longitude} onPick={selectMapLocation} />
                            </div>
                          )}
                        </div>

                        {/* PRIVATE REPORTER CONTACT */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            Phone or email <span className="text-slate-400 font-normal">(optional)</span>
                          </label>
                          <input 
                            type="text" 
                            value={reportForm.reporterContact} 
                            onChange={e => setReportForm({...reportForm, reporterContact: e.target.value})} 
                            placeholder="For updates about this report"
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" 
                          />
                        </div>

                        {/* DESCRIPTION */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            What happened? <span className="text-emerald-600">*</span>
                          </label>
                          <textarea 
                            rows={3}
                            value={reportForm.description}
                            onChange={(e) => setReportForm({...reportForm, description: e.target.value})}
                            placeholder="Briefly describe the problem"
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                          />
                        </div>

                        {/* ACTION BUTTONS */}
                        <div className="flex items-center justify-between pt-3">
                          <button 
                            onClick={() => setReportStep(1)} 
                            className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                          >
                            ← Change photo
                          </button>
                          <button 
                            onClick={handleFinalSubmit}
                            disabled={isSubmitting || (aiAnalysis?.is_civic_issue === false && aiAnalysis?.confidence >= 0.75)}
                            className="px-8 py-3.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                          >
                            {isSubmitting ? (
                              <>
                                <Icon name="refresh-cw" className="w-4 h-4 animate-spin text-white" />
                                <span>Submitting…</span>
                              </>
                            ) : (
                              <>
                                <span>Submit report</span>
                                <Icon name="arrow-right" className="w-4 h-4 text-white" />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 3. TRACK REPORT & BEFORE/AFTER INTERACTIVE SLIDER */}
            {activeTab === 'track' && submittedReportId && (
              <div className="max-w-xl mx-auto px-4 py-12 sm:py-16">
                <section aria-labelledby="report-success-title" className="bg-white dark:bg-slate-800 border border-emerald-500/30 rounded-2xl p-6 sm:p-10 text-center shadow-lg">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50">
                    <Icon name="check" className="h-7 w-7" />
                  </div>
                  <h1 id="report-success-title" className="mt-5 text-2xl font-bold text-slate-900 dark:text-white">Report submitted</h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Save this report ID. You can use it to check progress anytime.</p>
                  <div className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-6 py-5">
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Your report ID</div>
                    <div className="mt-1 font-mono text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">{submittedReportId}</div>
                  </div>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <button onClick={() => { navigator.clipboard?.writeText(submittedReportId); showToast('Report ID copied.'); }} className="min-h-12 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 px-5 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-all">Copy report ID</button>
                    <button onClick={() => setSubmittedReportId('')} className="min-h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-all px-5">Track this report</button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'track' && !submittedReportId && !selectedReport && (
              <div className="max-w-xl mx-auto px-4 py-16">
                <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 sm:p-10 space-y-5 reveal-up">
                  <div>
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Citizen Transparency</span>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight mt-1">Track a Report</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                      Enter your report ID to see its current status, responsible municipal authority, and completion evidence.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="tracking-id" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Report ID</label>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input 
                        id="tracking-id"
                        value={trackingQuery} 
                        onChange={e => setTrackingQuery(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && trackById()} 
                        placeholder="CP-ABC123 or ABC123"
                        className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 px-4 py-3 text-slate-900 dark:text-white font-mono text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                      />
                      <button 
                        onClick={trackById} 
                        disabled={trackingBusy}
                        className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-all disabled:opacity-50"
                      >
                        {trackingBusy ? 'Finding…' : 'Track'}
                      </button>
                    </div>
                  </div>
                  {trackingError && <div role="alert" className="text-xs text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-3">{trackingError}</div>}
                  <button onClick={openJudgeDemo} className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1.5">
                    See public report
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'track' && !submittedReportId && selectedReport && (
              <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 space-y-8 reveal-up">
                {/* INCIDENT HEADER CARD */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                        {selectedReport.id}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        selectedReport.status === 'Resolved' 
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' 
                          : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      }`}>
                        {selectedReport.status}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        selectedReport.severity === 'Critical' ? 'bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                      }`}>
                        {selectedReport.severity}
                      </span>
                    </div>

                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-2 tracking-tight break-words">{selectedReport.title}</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-1.5">
                      <Icon name="map-pin" className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{selectedReport.location}</span>
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <div className="flex gap-2">
                      <input 
                        value={trackingQuery} 
                        onChange={e => setTrackingQuery(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && trackById()} 
                        placeholder="Search ID" 
                        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 px-3.5 py-2 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 w-36" 
                      />
                      <button 
                        onClick={trackById} 
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all"
                      >
                        Track
                      </button>
                    </div>
                    <select 
                      value={selectedReport.id}
                      onChange={(e) => setSelectedReport(reports.find(r => r.id === e.target.value))}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {reports.map(r => (
                        <option key={r.id} value={r.id} className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200">{r.id} · {r.category}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2-COLUMN TIMELINE & EVIDENCE VERIFICATION WORKSPACE */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                  {/* TIMELINE COLUMN */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-7 space-y-6 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                      <h2 className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest font-mono flex items-center gap-2">
                        <Icon name="clock" className="w-4 h-4 text-emerald-600" />
                        Report progress
                      </h2>
                    </div>
                    
                    <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2.5 before:bottom-2.5 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
                      {selectedReport.timeline.map((item, idx) => (
                        <div key={idx} className="relative">
                          <div className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full border-2 transition-all ${
                            item.done ? 'bg-emerald-600 border-emerald-600' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600'
                          }`} />
                          <div className="text-xs font-bold text-slate-900 dark:text-white">{item.step}</div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">{item.time}</div>
                          {item.note && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">{item.note}</div>}
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span>Responsible Public Authority</span>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            {selectedReport.assigned_authority?.authority_data_status === 'gazette_verified' ? 'Gazette Verified' : 'Candidate Authority'}
                          </span>
                          {selectedReport.assigned_authority?.jurisdiction_data_status === 'statutory_polygon_verified' ? (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              Statutory Verified
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                              Location Inferred
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-4 rounded-xl text-xs space-y-2">
                        <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                          <Icon name="building-2" className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>
                            {selectedReport.assigned_authority?.authority_name
                              ? `${selectedReport.assigned_authority.authority_name} (${selectedReport.assigned_authority.short_code})`
                              : (selectedReport.needs_review || selectedReport.department === 'Needs Review' ? 'Awaiting Authority Review' : selectedReport.department)}
                          </span>
                        </div>
                        {selectedReport.assigned_authority?.department && selectedReport.assigned_authority?.authority_name && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 pl-6">
                            Department: <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedReport.assigned_authority.department}</span>
                          </div>
                        )}
                        {selectedReport.assigned_authority?.jurisdiction && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 pl-6 flex items-center gap-1.5">
                            <Icon name="map-pin" className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>Jurisdiction: {selectedReport.assigned_authority.jurisdiction}</span>
                          </div>
                        )}
                        {selectedReport.assigned_authority?.assignment_reason && (
                          <div className="text-[10px] text-slate-400 dark:text-slate-400 pl-6 border-t border-slate-200 dark:border-slate-700/60 pt-1.5 leading-snug">
                            {selectedReport.assigned_authority.assignment_reason}
                          </div>
                        )}
                      </div>
                      {selectedReport.priority_score != null && (
                        <details className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800">
                          <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-400">Why this priority?</summary>
                          <div className="flex items-center justify-between text-xs mt-2">
                            <span className="font-bold text-slate-900 dark:text-white">Priority</span>
                            <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">{selectedReport.priority_score}/100</span>
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Based on urgency, how many people reported it, how long it has waited, and location safety.</p>
                        </details>
                      )}
                    </div>
                  </div>

                  {/* EVIDENCE & VERIFICATION COLUMN */}
                  <div className="lg:col-span-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-7 space-y-6 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                      <h2 className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest font-mono flex items-center gap-2">
                        <Icon name="shield-check" className="w-4 h-4 text-emerald-600" />
                        RESOLUTION & EVIDENCE
                      </h2>
                      {selectedReport.status === 'Resolved' || selectedReport.citizen_verification?.fixed ? (
                        <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
                          <span>✓</span> Citizen Confirmed & Resolved
                        </span>
                      ) : selectedReport.afterImage || selectedReport.resolution_evidence ? (
                        <span className="text-xs text-amber-700 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-950/40 px-3 py-1 rounded-full border border-amber-200 dark:border-amber-800 flex items-center gap-1.5">
                          <span>⏳</span> Awaiting Citizen Verification
                        </span>
                      ) : null}
                    </div>

                    {/* RESOLUTION VERIFICATION */}
                    <div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mb-2 font-bold uppercase tracking-wider">// RESOLUTION VERIFICATION GATES</div>
                      <div className="border border-[#1E293B] rounded-2xl overflow-hidden bg-[#0A101D] shadow-2xl">
                        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#1E293B]">
                          {/* Gate 01: Field Officer Evidence */}
                          <div className="p-6 flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
                            <div>
                              <div className="flex items-center justify-between mb-4">
                                <span className="font-headline text-2xl font-black uppercase text-[#38BDF8]">01</span>
                                <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${
                                  selectedReport.officer_evidence_submitted || selectedReport.resolution_evidence ? 'bg-[#082820] border-[#059669]/60 text-[#10B981]' : 'bg-[#131D2D] border-[#223247] text-[#38BDF8]'
                                }`}>
                                  <Icon name="landmark" className="w-4 h-4" />
                                </div>
                              </div>
                              <h4 className="font-headline text-base font-bold text-white mb-1.5 tracking-tight">Field Officer Evidence</h4>
                              <p className="text-xs text-slate-400 leading-relaxed">Photographic proof and work-order completion logs from dispatch crew.</p>
                            </div>
                            <div className="mt-6 pt-3 border-t border-[#1E293B] flex items-center justify-between font-mono text-[10px]">
                              <span className="flex items-center gap-1.5 text-slate-400">
                                <span className={`w-2 h-2 rounded-[2px] ${selectedReport.officer_evidence_submitted || selectedReport.resolution_evidence ? 'bg-[#10B981]' : 'bg-[#F59E0B]'}`}></span>
                                <span>MUNICIPAL LOG</span>
                              </span>
                              <span className={`font-bold uppercase tracking-wider ${selectedReport.officer_evidence_submitted || selectedReport.resolution_evidence ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                                {selectedReport.officer_evidence_submitted || selectedReport.resolution_evidence ? '✓ SUBMITTED' : 'PENDING'}
                              </span>
                            </div>
                          </div>

                          {/* Gate 02: Citizen Verification */}
                          <div className="p-6 flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
                            <div>
                              <div className="flex items-center justify-between mb-4">
                                <span className="font-headline text-2xl font-black uppercase text-white">02</span>
                                <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${
                                  selectedReport.citizen_verification?.fixed || selectedReport.resolution_approvals?.reporter ? 'bg-[#082820] border-[#059669]/60 text-[#10B981]' : 'bg-[#131D2D] border-[#223247] text-[#38BDF8]'
                                }`}>
                                  <Icon name="check" className="w-4 h-4" />
                                </div>
                              </div>
                              <h4 className="font-headline text-base font-bold text-white mb-1.5 tracking-tight">Citizen Verification</h4>
                              <p className="text-xs text-slate-400 leading-relaxed">Reporter on-site inspection and token approval before final ticket closure.</p>
                            </div>
                            <div className="mt-6 pt-3 border-t border-[#1E293B] flex items-center justify-between font-mono text-[10px]">
                              <span className="flex items-center gap-1.5 text-slate-400">
                                <span className={`w-2 h-2 rounded-[2px] ${selectedReport.citizen_verification?.fixed || selectedReport.resolution_approvals?.reporter ? 'bg-[#10B981]' : 'bg-[#F59E0B]'}`}></span>
                                <span>TWO-PARTY AUDIT</span>
                              </span>
                              <span className={`font-bold uppercase tracking-wider ${selectedReport.citizen_verification?.fixed || selectedReport.resolution_approvals?.reporter ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                                {selectedReport.citizen_verification?.fixed || selectedReport.resolution_approvals?.reporter ? '✓ VERIFIED' : 'PENDING'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* CONTRACTOR STAR RATING */}
                    {selectedReport.afterImage && selectedReport.assigned_contractor_id && (authUser?.role === 'admin' || sessionStorage.getItem(`urbanfix-reporter-${selectedReport.id}`)) && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Icon name="star" className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                            Rate Contractor Performance
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Rate quality, speed, and clean-up execution</p>
                        </div>
                        <div className="flex gap-1.5">
                          {[1, 2, 3, 4, 5].map(score => (
                            <button 
                              key={score} 
                              onClick={() => rateContractor(selectedReport, score)} 
                              className="text-2xl text-amber-400 hover:scale-125 transition-transform" 
                              aria-label={`${score} stars`}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* INTERACTIVE BEFORE/AFTER IMAGE SLIDER */}
                    <InteractiveBeforeAfter
                      beforeImage={selectedReport.beforeImage}
                      afterImage={selectedReport.afterImage}
                      altBefore="Reported problem"
                      altAfter="After resolution"
                    />

                    {/* CITIZEN VERIFICATION CARD */}
                    {(selectedReport.afterImage || selectedReport.resolution_evidence || ['Evidence Uploaded', 'Verification', 'Resolution Submitted', 'Resolved', 'Reopened - Needs Review'].includes(selectedReport.status)) && (
                      <div data-testid="citizen-verification-card" className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 p-5 sm:p-6 space-y-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                          <div className="flex items-center gap-2">
                            <Icon name="shield-check" className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span className="text-xs font-bold text-slate-900 dark:text-white tracking-wider uppercase">Citizen Verification Gate</span>
                          </div>
                          <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            Simulated Authority Workflow
                          </span>
                        </div>

                        {/* If already confirmed & resolved */}
                        {(selectedReport.status === 'Resolved' || selectedReport.citizen_verification?.fixed) ? (
                          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold font-mono text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                <Icon name="circle-check" className="w-4 h-4" />
                                RESOLUTION CONFIRMED BY CITIZEN
                              </span>
                              <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
                                Status: Resolved
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                              The reporter confirmed this incident was successfully fixed on site.
                            </p>
                            {selectedReport.citizen_verification?.note && (
                              <div className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 italic">
                                "{selectedReport.citizen_verification.note}"
                              </div>
                            )}
                          </div>
                        ) : selectedReport.status === 'Reopened - Needs Review' ? (
                          <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold font-mono text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                <Icon name="alert-triangle" className="w-4 h-4" />
                                RESOLUTION DISPUTED · REOPENED
                              </span>
                              <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
                                Reopened - Needs Review
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                              The citizen reported that the problem was not satisfactorily fixed. Authority field crew has been notified to re-inspect.
                            </p>
                            {selectedReport.citizen_verification?.note && (
                              <div className="text-xs text-amber-700 dark:text-amber-400 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 italic">
                                Dispute reason: "{selectedReport.citizen_verification.note}"
                              </div>
                            )}
                          </div>
                        ) : (
                          /* Pending verification form */
                          <div className="space-y-4">
                            {(selectedReport.completion_notes || selectedReport.resolution_evidence?.completion_note) && (
                              <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 text-xs">
                                <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold mb-1">FIELD OFFICER COMPLETION NOTE</div>
                                <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                                  {selectedReport.completion_notes || selectedReport.resolution_evidence?.completion_note}
                                </p>
                              </div>
                            )}

                            <div>
                              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                <span>REPORTER VERIFICATION TOKEN</span>
                                {sessionStorage.getItem(`urbanfix-reporter-${selectedReport.id}`) && (
                                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">✓ Active on this device</span>
                                )}
                              </div>
                              <input
                                type="text"
                                placeholder="Paste or verify reporter token..."
                                value={verificationToken || (selectedReport ? sessionStorage.getItem(`urbanfix-reporter-${selectedReport.id}`) || '' : '')}
                                onChange={(e) => setVerificationToken(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                FEEDBACK / NOTES (Required if rejecting or reporting partial fix)
                              </label>
                              <textarea
                                rows={2}
                                placeholder="Enter inspection feedback or reason for dispute..."
                                value={citizenFeedback}
                                onChange={(e) => setCitizenFeedback(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                              />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                              <button
                                disabled={isVerifying}
                                onClick={() => handleCitizenVerify('fixed')}
                                className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Icon name="check" className="w-4 h-4" />
                                <span>Confirm Fixed</span>
                              </button>
                              <button
                                disabled={isVerifying}
                                onClick={() => handleCitizenVerify('partially_fixed')}
                                className="py-2.5 px-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <span>Partially Fixed</span>
                              </button>
                              <button
                                disabled={isVerifying}
                                onClick={() => handleCitizenVerify('not_fixed')}
                                className="py-2.5 px-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Icon name="x" className="w-4 h-4" />
                                <span>Reject & Reopen</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedReport.resolution_evidence?.report_url && (
                      <a href={selectedReport.resolution_evidence.report_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-4 py-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:border-emerald-500 transition-all">
                        <span className="flex items-center gap-2"><Icon name="file-text" className="w-4 h-4" />View contractor work report</span>
                        <Icon name="external-link" className="w-4 h-4" />
                      </a>
                    )}

                    <div className="space-y-3">
                      <div>
                        <div className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Citizen Description</div>
                        <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-sans bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-4 rounded-xl">
                          {selectedReport.description || 'No written description was provided.'}
                        </p>
                      </div>
                      {selectedReport.summary && selectedReport.summary !== selectedReport.description && (
                        <div>
                          <div className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <Icon name="sparkles" className="w-3 h-3" />
                            <span>AI Assessment Summary (AI-generated)</span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-sans bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                            {selectedReport.summary}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-700 pt-4">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="text-slate-900 dark:text-white font-bold">{selectedReport.affected_count || 1}</span> citizens affected · <span className="text-slate-900 dark:text-white font-bold">{selectedReport.duplicates || 1}</span> linked incident reports
                      </div>
                      <button 
                        onClick={markAffected} 
                        className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-emerald-700 dark:text-emerald-400 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Icon name="thumbs-up" className="w-3.5 h-3.5" />
                        <span>I’m Affected Too (+1)</span>
                      </button>
                    </div>

                    <button 
                      onClick={() => loadAccountabilityReceipt(selectedReport)} 
                      className="w-full py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                    >
                      <Icon name="file-text" className="w-4 h-4 text-emerald-600" />
                      <span>View accountability receipt</span>
                    </button>
                  </div>
                </div>

                {/* ACCOUNTABILITY RECEIPT DISPLAY */}
                {accountabilityReceipt && accountabilityReceipt.complaint_id === selectedReport.id && (
                  <section aria-label="Public accountability receipt" className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm p-6 sm:p-8 space-y-6 reveal-up">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-4">
                      <div>
                        <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold tracking-widest uppercase">ACCOUNTABILITY RECEIPT</div>
                        <h2 className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">{accountabilityReceipt.incident_id || accountabilityReceipt.complaint_id}</h2>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                      <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-4">
                        <div className="text-slate-400 font-mono text-[10px] uppercase font-bold">AI CLASSIFICATION</div>
                        <div className="text-slate-900 dark:text-white font-bold mt-1 text-sm">{accountabilityReceipt.ai_assessment.category}</div>
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-semibold">{Math.round((accountabilityReceipt.ai_assessment.confidence || 0)*100)}% Confidence</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-4">
                        <div className="text-slate-400 font-mono text-[10px] uppercase font-bold">PRIORITY SCORE</div>
                        <div className="text-slate-900 dark:text-white font-bold mt-1 text-lg font-mono">{accountabilityReceipt.priority.score}/100</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-4">
                        <div className="text-slate-400 font-mono text-[10px] uppercase font-bold">LINKED REPORTS</div>
                        <div className="text-slate-900 dark:text-white font-bold mt-1 text-lg font-mono">{accountabilityReceipt.incident_report_count}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-4">
                        <div className="text-slate-400 font-mono text-[10px] uppercase font-bold">STATUS</div>
                        <div className={`font-bold mt-1 text-sm ${accountabilityReceipt.resolution.fully_verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                          {accountabilityReceipt.resolution.fully_verified ? 'Verified (2/2)' : 'Awaiting Approval'}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-sans">
                      {accountabilityReceipt.priority.methodology}
                    </p>
                  </section>
                )}
              </div>
            )}

            {/* 4. PUBLIC CIVIC MAP */}
            {activeTab === 'map' && (
              <div className="max-w-7xl mx-auto px-4 py-8 sm:py-10 space-y-6 reveal-up">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 sm:p-8 rounded-2xl shadow-sm">
                  <div>
                    <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider">Public reports</div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mt-1 tracking-tight">Issues near you</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Select a marker to see the problem and its current status.</p>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {['All', 'Roads', 'Sanitation', 'Water'].map((f) => {
                      const count = reports.filter(rep => f === 'All' || (f === 'Roads' && /road/i.test(rep.category)) || (f === 'Sanitation' && /waste|sanitation/i.test(rep.category)) || (f === 'Water' && /water|drain|sewer/i.test(rep.category))).length;
                      return (
                        <button 
                          onClick={() => setMapFilter(f)} 
                          key={f} 
                          className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                            mapFilter === f 
                              ? 'bg-emerald-600 text-white shadow-sm' 
                              : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <span>{f}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${mapFilter === f ? 'bg-emerald-700 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
                  <AuthorityMap
                    reports={reports.filter(rep => mapFilter === 'All' || (mapFilter === 'Roads' && /road/i.test(rep.category)) || (mapFilter === 'Sanitation' && /waste|sanitation/i.test(rep.category)) || (mapFilter === 'Water' && /water|drain|sewer/i.test(rep.category)))}
                    onSelect={report => { setSelectedReport(report); setActiveTab('track'); }}
                    useClusters={reportsTruncated}
                  />
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2 text-xs">
                    <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60 p-3 rounded-xl flex items-center gap-2.5 text-slate-600 dark:text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10B981]" /> 
                      <span className="font-medium">Verified by Citizen</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60 p-3 rounded-xl flex items-center gap-2.5 text-slate-600 dark:text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-[0_0_6px_#0EA5E9]" /> 
                      <span className="font-medium">In Progress</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60 p-3 rounded-xl flex items-center gap-2.5 text-slate-600 dark:text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> 
                      <span className="font-medium">Assigned to Crew</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60 p-3 rounded-xl flex items-center gap-2.5 text-slate-600 dark:text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_6px_#F43F5E]" /> 
                      <span className="font-medium">Critical / Urgent</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. COMMUNITY ACTION (YOUTH MICRO-MAINTENANCE) */}
            {activeTab === 'community' && (
              <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12 space-y-7 reveal-up">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 sm:p-8 rounded-2xl shadow-sm">
                  <div className="text-[10px] font-mono tracking-widest text-emerald-600 dark:text-emerald-400 font-bold uppercase">SUPERVISED COMMUNITY ACTION</div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-1 tracking-tight">Propose Low-Risk Micro-Maintenance</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    Only low-risk cleanup and neighborhood beautification tasks appear here. High-voltage, deep trenches, and hazardous tasks are restricted to certified municipal crews.
                  </p>
                </div>

                {!authUser ? (
                  <AuthCard 
                    title="Community Youth Worker Access" 
                    subtitle="Register or log in to submit neighborhood repair proposals and request authority escrow funding." 
                    mode={authMode} 
                    setMode={mode => { setAuthMode(mode); setAuthError(''); }} 
                    form={authForm} 
                    setForm={setAuthForm} 
                    submit={authenticate} 
                    busy={authBusy} 
                    error={authError} 
                  />
                ) : authUser.role !== 'youth' ? (
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8 text-center space-y-4 shadow-sm">
                    <p className="text-sm text-slate-600 dark:text-slate-400">The current active account is not registered as a youth worker.</p>
                    <button 
                      onClick={logout} 
                      className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-sans text-xs font-bold uppercase shadow-sm transition-all inline-flex items-center gap-1.5 cursor-pointer border border-red-700"
                    >
                      <Icon name="log-out" className="w-3.5 h-3.5 text-white" />
                      <span>Log Out</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm mb-6">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-slate-900 dark:text-white">{authUser.name}</span>
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            VERIFIED CITIZEN
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{authUser.email} · Proposals & proof linked to escrow balance</div>
                      </div>
                      <button 
                        onClick={logout} 
                        className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-sans text-xs font-bold uppercase shadow-sm transition-all flex items-center gap-1.5 cursor-pointer border border-red-700"
                      >
                        <Icon name="log-out" className="w-3.5 h-3.5 text-white" />
                        <span>Log Out</span>
                      </button>
                    </div>

                    {/* Youth 3-Step Escrow Workflow Box (Contiguous Cadastre Box Grid matching reference design) */}
                    <div className="bg-[#0A101D] border border-[#1E293B] rounded-2xl overflow-hidden shadow-2xl mb-8">
                      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#1E293B]">
                        {/* Step 01 */}
                        <div className="p-6 sm:p-8 flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-4">
                              <span className="font-headline text-3xl sm:text-4xl text-[#38BDF8] font-black select-none leading-none">
                                01
                              </span>
                              <div className="w-9 h-9 rounded-lg bg-[#0F172A] border border-[#334155] flex items-center justify-center text-[#38BDF8]">
                                <Icon name="file-text" className="w-4 h-4" />
                              </div>
                            </div>
                            <h3 className="font-headline text-lg font-bold text-white mb-2 tracking-tight">
                              Submit Proposal
                            </h3>
                            <p className="text-xs text-slate-400 leading-relaxed font-normal">
                              Draft a repair plan, materials needed, and budget estimate for an eligible neighborhood issue.
                            </p>
                          </div>
                          <div className="mt-6 pt-4 border-t border-[#1E293B] flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-slate-400">
                            <span className="w-2 h-2 rounded-[2px] bg-[#38BDF8]"></span>
                            <span>Civic Estimate Dispatch</span>
                          </div>
                        </div>

                        {/* Step 02 */}
                        <div className="p-6 sm:p-8 flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-4">
                              <span className="font-headline text-3xl sm:text-4xl text-[#F59E0B] font-black select-none leading-none">
                                02
                              </span>
                              <div className="w-9 h-9 rounded-lg bg-[#0F172A] border border-[#334155] flex items-center justify-center text-[#F59E0B]">
                                <Icon name="shield" className="w-4 h-4" />
                              </div>
                            </div>
                            <h3 className="font-headline text-lg font-bold text-white mb-2 tracking-tight">
                              Escrow Lock
                            </h3>
                            <p className="text-xs text-slate-400 leading-relaxed font-normal">
                              Municipal authority officers inspect the plan and lock guaranteed funds into escrow.
                            </p>
                          </div>
                          <div className="mt-6 pt-4 border-t border-[#1E293B] flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-slate-400">
                            <span className="w-2 h-2 rounded-[2px] bg-[#F59E0B]"></span>
                            <span>Government Backed Funds</span>
                          </div>
                        </div>

                        {/* Step 03 */}
                        <div className="p-6 sm:p-8 flex flex-col justify-between hover:bg-white/[0.02] transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-4">
                              <span className="font-headline text-3xl sm:text-4xl text-[#10B981] font-black select-none leading-none">
                                03
                              </span>
                              <div className="w-9 h-9 rounded-lg bg-[#0F172A] border border-[#334155] flex items-center justify-center text-[#10B981]">
                                <Icon name="check-circle" className="w-4 h-4" />
                              </div>
                            </div>
                            <h3 className="font-headline text-lg font-bold text-white mb-2 tracking-tight">
                              Verify & Payout
                            </h3>
                            <p className="text-xs text-slate-400 leading-relaxed font-normal">
                              Submit timestamped photographic proof of resolution to immediately release the micro-grant.
                            </p>
                          </div>
                          <div className="mt-6 pt-4 border-t border-[#1E293B] flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-slate-400">
                            <span className="w-2 h-2 rounded-[2px] bg-[#10B981]"></span>
                            <span>Direct MFS Payout</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      {/* PROPOSAL FORM */}
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-7 space-y-4 shadow-sm">
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Submit New Proposal</h2>
                        <select 
                          value={repairForm.complaint_id} 
                          onChange={e => setRepairForm({...repairForm, complaint_id: e.target.value})} 
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        >
                          <option value="" className="bg-white dark:bg-slate-800">Select an eligible low-risk task</option>
                          {reports.filter(r => r.status !== 'Resolved' && r.volunteer_eligible === true).map(r => (
                            <option key={r.id} value={r.id} className="bg-white dark:bg-slate-800">{r.id} · {r.category} · {r.location}</option>
                          ))}
                        </select>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <input 
                            type="number" 
                            min="1" 
                            value={repairForm.estimated_price} 
                            onChange={e => setRepairForm({...repairForm, estimated_price: e.target.value})} 
                            placeholder="Estimate (BDT)" 
                            className="min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                          />
                          <input 
                            type="number" 
                            min="1" 
                            value={repairForm.estimated_hours} 
                            onChange={e => setRepairForm({...repairForm, estimated_hours: e.target.value})} 
                            placeholder="Hours required" 
                            className="min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                          />
                        </div>
                        <textarea 
                          rows="4" 
                          value={repairForm.plan} 
                          onChange={e => setRepairForm({...repairForm, plan: e.target.value})} 
                          placeholder="Detail materials needed, safe tools, clean-up steps, and expected completion result..." 
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                        <button 
                          onClick={submitRepairRequest} 
                          disabled={!repairForm.complaint_id || repairForm.plan.length < 10 || !repairForm.estimated_price} 
                          className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-all disabled:opacity-40 cursor-pointer"
                        >
                          Send Proposal to Authority
                        </button>
                      </div>

                      {/* PROPOSAL HISTORY */}
                      <div className="space-y-4">
                        <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Your Proposal Ledger</h2>
                        {repairRequests.length ? repairRequests.slice().reverse().map(req => (
                          <div key={req.request_id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-3 shadow-sm">
                            <div className="flex justify-between gap-3">
                              <div>
                                <div className="font-mono text-emerald-600 dark:text-emerald-400 text-xs font-bold">{req.request_id} · {req.complaint_id}</div>
                                <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">{req.issue_title || req.applicant_name}</div>
                              </div>
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono font-bold bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-full h-fit">
                                {req.status}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                              Budget: BDT {Number(req.estimated_price).toLocaleString()} · {req.estimated_hours}h
                            </div>
                            {req.admin_note && (
                              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs text-slate-600 dark:text-slate-300">
                                <span className="text-slate-400 font-mono text-[10px] block uppercase font-bold">AUTHORITY NOTE</span> {req.admin_note}
                              </div>
                            )}
                            {req.status === 'Approved - Awaiting Work' && (
                              <label className="block cursor-pointer text-center text-xs px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 transition-colors font-semibold">
                                📷 Upload Required After-Repair Photo
                                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={e => submitProofFile(req, e.target.files?.[0])} />
                              </label>
                            )}
                            {req.proof && (
                              <div className="flex gap-3 items-center bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-3 rounded-xl">
                                <img src={absoluteMediaUrl(req.proof.after_image_url)} alt="Your after-repair proof" className="w-16 h-14 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">After photo uploaded for authority release.</span>
                              </div>
                            )}
                          </div>
                        )) : (
                          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8 text-center text-xs text-slate-500 dark:text-slate-400 shadow-sm">
                            No repair proposals yet. Choose an open problem on the map to get started.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 6. CONTRACTOR PORTAL */}
            {activeTab === 'contractor' && (
              authUser?.role !== 'contractor' ? (
                <div className="max-w-md mx-auto px-4 py-12 space-y-5 reveal-up">
                  <div className="flex bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-1">
                    <button onClick={() => setAuthMode('login')} className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all ${authMode === 'login' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>Login</button>
                    <button onClick={() => setAuthMode('register')} className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all ${authMode === 'register' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>Register</button>
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-8 space-y-4 shadow-sm">
                    <div>
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Service Partner Network</span>
                      <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">Contractor Service Hub</h1>
                    </div>
                    {authMode === 'register' && (
                      <input value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} placeholder="Business or contractor name" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                    )}
                    <input type="email" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} placeholder="Contractor email" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                    {authMode === 'register' && (
                      <>
                        <input value={authForm.phone} onChange={e => setAuthForm({...authForm, phone: e.target.value})} placeholder="Phone number" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                        <input value={contractorForm.service_area} onChange={e => setContractorForm({...contractorForm, service_area: e.target.value})} placeholder="Service area (e.g. Zone 4)" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                        <input value={contractorForm.skills} onChange={e => setContractorForm({...contractorForm, skills: e.target.value})} placeholder="Skills (Roads, Asphalt, Plumbing, Electrical)" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                        <input value={contractorForm.payout_account_id} onChange={e => setContractorForm({...contractorForm, payout_account_id: e.target.value})} placeholder="Stripe Connect account (acct_…)" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                      </>
                    )}
                    <input type="password" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} placeholder="Password" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                    {authMode === 'register' && (
                      <input type="password" value={authForm.confirmPassword} onChange={e => setAuthForm({...authForm, confirmPassword: e.target.value})} placeholder="Confirm password" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-3 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                    )}
                    {authError && <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-3 rounded-xl">{authError}</div>}
                    <button onClick={authenticateContractor} disabled={authBusy} className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-all disabled:opacity-40 cursor-pointer">
                      {authBusy ? 'Authenticating…' : authMode === 'register' ? 'Submit Registration' : 'Contractor Sign In'}
                    </button>
                  </div>
                  {authUser && (
                    <div className="text-center pt-2">
                      <button 
                        onClick={logout} 
                        className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-sans text-xs font-bold uppercase shadow-sm transition-all inline-flex items-center gap-1.5 cursor-pointer border border-red-700"
                      >
                        <Icon name="log-out" className="w-3.5 h-3.5 text-white" />
                        <span>Log out of current session</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 space-y-7 reveal-up">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 sm:p-8 rounded-2xl shadow-sm">
                    <div>
                      <div className="text-[10px] font-mono tracking-widest text-emerald-600 dark:text-emerald-400 font-bold uppercase">CONTRACTOR OPERATIONS PORTAL</div>
                      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-1">{contractorProfile?.name || 'Contractor Hub'}</h1>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">Status: {contractorProfile?.approval_status || 'Approved'} · Rating: ★ {contractorProfile?.rating || '5.0'}</p>
                    </div>
                    <button 
                      onClick={logout} 
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-sans text-xs font-bold uppercase shadow-sm transition-all flex items-center gap-1.5 cursor-pointer border border-red-700"
                    >
                      <Icon name="log-out" className="w-3.5 h-3.5 text-white" />
                      <span>Log Out</span>
                    </button>
                  </div>

                  <div className="space-y-4">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Assigned Work Orders</h2>
                    {contractorJobs.map(job => (
                      <div key={job.offer_id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4 shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold">{job.offer_id} · {job.complaint_id}</div>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">{job.issue_title}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">{job.work_location_area} · Budget: BDT {Number(job.budget_cap).toLocaleString()} · SLA: {job.sla_hours}h</p>
                          </div>
                          <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-1 rounded-full h-fit">
                            {job.status}
                          </span>
                        </div>
                        <div className="flex gap-2.5 pt-2">
                          {job.status === 'Sent' && (
                            <>
                              <button onClick={() => updateContractorJob(job, 'Rejected')} className="px-4 py-2 rounded-xl border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 text-xs font-semibold transition-colors cursor-pointer">
                                Reject
                              </button>
                              <button onClick={() => updateContractorJob(job, 'Accepted')} className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer">
                                Accept Order
                              </button>
                            </>
                          )}
                          {job.status === 'Accepted' && (
                            <button onClick={() => updateContractorJob(job, 'In Progress')} className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer">
                              Start Work On-Site
                            </button>
                          )}
                          {job.status === 'In Progress' && (
                            <div className="w-full grid gap-3 sm:grid-cols-2">
                              <label className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs text-slate-500 dark:text-slate-400 cursor-pointer"><span>{contractorProofs[job.offer_id]?.image?.name || 'Choose completion photo'}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),image:e.target.files?.[0] || null}})} /></label>
                              <input type="url" value={contractorProofs[job.offer_id]?.report_url || ''} onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),report_url:e.target.value}})} placeholder="Public Google Drive report link" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs text-slate-900 dark:text-white" />
                              <textarea value={contractorProofs[job.offer_id]?.note || ''} onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),note:e.target.value}})} placeholder="Short completion summary" rows="2" className="sm:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs text-slate-900 dark:text-white resize-none" />
                              <label className="sm:col-span-2 flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                                <input type="checkbox" checked={Boolean(contractorProofs[job.offer_id]?.public_access_confirmed)} onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),public_access_confirmed:e.target.checked}})} className="mt-0.5 accent-emerald-600" />
                                <span>I confirm the Google Drive report is set to <strong className="text-slate-900 dark:text-white">Anyone with the link can view</strong>.</span>
                              </label>
                              <button onClick={() => updateContractorJob(job, 'Proof Submitted')} className="sm:col-span-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer">Submit completed work for review</button>
                            </div>
                          )}
                          {job.status === 'Proof Submitted' && <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">Completion proof submitted. Waiting for authority verification.</p>}
                        </div>
                      </div>
                    ))}
                    {!contractorJobs.length && (
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-12 text-center text-xs text-slate-500 dark:text-slate-400 shadow-sm">
                        No active work orders currently assigned to your team.
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {/* 7. AUTHORITY COMMAND CENTER */}
            {activeTab === 'admin' && (
              !['admin', 'officer'].includes(authUser?.role) ? (
                <div className="max-w-4xl mx-auto px-4 py-10 space-y-5 reveal-up">
                  <AuthCard
                    title="Municipal Authority Command Center"
                    subtitle="Executive governance console for dispatch, SLA auditing, and public escrow releases."
                    mode="login"
                    setMode={() => { }}
                    form={authForm}
                    setForm={setAuthForm}
                    submit={() => authenticate('login')}
                    busy={authBusy}
                    error={authError}
                    allowRegister={false}
                    demoCredentials
                    onDemoOfficerLogin={handleDemoOfficerLogin}
                  />
                  {authUser && (
                    <div className="text-center pt-2">
                      <button 
                        onClick={logout} 
                        className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-sans text-xs font-bold uppercase shadow-md hover:shadow-lg transition-all inline-flex items-center gap-1.5 cursor-pointer border border-red-700"
                      >
                        <Icon name="log-out" className="w-3.5 h-3.5 text-white" />
                        <span>Log out of {authUser.email}</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8 reveal-up">
                  {/* COMMAND HEADER */}
                  <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-100 dark:border-slate-700/60 pb-6">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-400 shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>নাগরিক সেবা ও পৌর নিয়ন্ত্রণ কেন্দ্র · Municipal Command</span>
                          </span>
                          {authUser?.role === 'officer' && (
                            <span className="text-xs font-semibold px-3 py-1 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300">
                              কর্তৃপক্ষ: {authUser.authority_id}
                            </span>
                          )}
                          <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300">
                            DIGITAL CADASTRE
                          </span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold font-headline text-slate-900 dark:text-white tracking-tight">
                          {authUser?.role === 'officer' ? `${authUser.name} Operations Hub` : 'Authority Command Dashboard'}
                        </h1>
                        <p className="text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
                          {authUser?.role === 'officer'
                            ? `সরাসরি দায়িত্বপ্রাপ্ত পৌর কর্মকর্তা · ${authUser.department || 'Road & Civil Infrastructure Maintenance'}`
                            : 'সিটি করপোরেশন ও পৌর নির্বাহী ড্যাশবোর্ড: জরুরি অভিযোগ পর্যালোচনা, ফিল্ড টিমের কাজের প্রমাণ যাচাই ও নাগরিক সেবা নিশ্চিতকরণ।'}
                        </p>
                      </div>

                      {/* Active Officer Status & Prominent Red Log Out */}
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="hidden sm:flex flex-col text-right">
                          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">দায়িত্বপ্রাপ্ত ইউজার</span>
                          <span className="text-sm font-bold text-slate-900 dark:text-white">{authUser?.name || authUser?.email}</span>
                        </div>
                        <button 
                          onClick={logout} 
                          title="Sign out of authority session"
                          className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-sans text-xs font-bold uppercase shadow-sm hover:shadow transition-all flex items-center gap-2 cursor-pointer border border-red-700"
                        >
                          <Icon name="log-out" className="w-4 h-4 text-white" />
                          <span>Log Out</span>
                        </button>
                      </div>
                    </div>

                    {/* SUB-NAVIGATION TAB RIBBON */}
                    <div className="flex items-center gap-2.5 overflow-x-auto pb-1 scrollbar-none pt-1">
                      {[
                        ['queue', 'list-filter', 'Work Queue'],
                        ['review', 'user-check', `Human Review (${reports.filter(r => r.needs_review || r.status === 'Needs Review').length})`],
                        ['proofs', 'clipboard-check', `Proof Reviews (${reports.filter(r => r.status === 'Evidence Uploaded').length})`],
                        ['map', 'map', 'Spatial Map'],
                        ['contractors', 'hard-hat', 'Contractors'],
                        ['whatsapp', 'message-circle', 'WhatsApp'],
                        ['funding', 'hand-coins', 'Youth Escrow']
                      ].map(([id, icon, label]) => (
                        <button
                          key={id}
                          onClick={() => setAdminView(id)}
                          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
                            adminView === id
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          <Icon name={icon} className="w-4 h-4" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* KPI STATS ROW (Matching User's Reference Box Design) */}
                  <div className="border border-[#1E293B] rounded-2xl overflow-hidden bg-[#0A101D] shadow-2xl">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#1E293B]">
                      {[
                        {
                          num: '01',
                          label: 'Human Review',
                          val: reports.filter(r => r.needs_review || r.status === 'Needs Review').length,
                          alert: true,
                          icon: 'user-check',
                          desc: 'Routing ambiguity or boundary flags requiring officer sign-off.',
                          meta: 'TRIAGE QUEUE: IMMEDIATE',
                          numColor: 'text-red-400',
                          badgeBg: 'bg-red-500/10 border-red-500/40 text-red-400',
                          bullet: 'bg-red-500',
                        },
                        {
                          num: '02',
                          label: 'Proof Reviews',
                          val: reports.filter(r => r.status === 'Evidence Uploaded').length,
                          alert: false,
                          icon: 'clipboard-check',
                          desc: 'Resolution proofs submitted by crews awaiting confirmation.',
                          meta: 'TWO-PARTY VERIFICATION',
                          numColor: 'text-[#38BDF8]',
                          badgeBg: 'bg-[#0C243C] border-[#0284C7]/50 text-[#38BDF8]',
                          bullet: 'bg-[#38BDF8]',
                        },
                        {
                          num: '03',
                          label: 'SLA Overdue',
                          val: dashboard?.stats?.overdue_cases ?? reports.filter(r => (r.sla_status || '').startsWith('Overdue')).length,
                          alert: true,
                          icon: 'clock',
                          desc: 'Incidents exceeding statutory resolution deadlines across wards.',
                          meta: 'SLA ESCALATION FLAG',
                          numColor: 'text-amber-400',
                          badgeBg: 'bg-amber-500/10 border-amber-500/40 text-amber-400',
                          bullet: 'bg-amber-400',
                        },
                        {
                          num: '04',
                          label: 'Active Work',
                          val: dashboard?.stats?.active_issues ?? reports.filter(r => r.status !== 'Resolved').length,
                          alert: false,
                          icon: 'inbox',
                          desc: 'Work orders assigned and currently in progress on site.',
                          meta: 'MUNICIPAL DISPATCH SYNC',
                          numColor: 'text-[#10B981]',
                          badgeBg: 'bg-[#082820] border-[#059669]/50 text-[#10B981]',
                          bullet: 'bg-[#10B981]',
                        }
                      ].map((kpi, idx) => (
                        <div
                          key={idx}
                          className="p-6 sm:p-8 flex flex-col justify-between hover:bg-slate-900/50 transition-colors"
                        >
                          <div>
                            <div className="flex items-center justify-between mb-5">
                              <span className={`font-headline text-3xl sm:text-4xl font-extrabold tracking-tight leading-none ${kpi.numColor}`}>
                                {kpi.val}
                              </span>
                              <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${kpi.badgeBg}`}>
                                <Icon name={kpi.icon} className="w-5 h-5" />
                              </div>
                            </div>
                            <h3 className="font-headline text-base font-bold text-white mb-2 tracking-tight flex items-center gap-2">
                              <span>{kpi.label}</span>
                              {kpi.alert && kpi.val > 0 && (
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                              )}
                            </h3>
                            <p className="text-xs text-slate-400 leading-relaxed">
                              {kpi.desc}
                            </p>
                          </div>
                          <div className="mt-8 pt-4 border-t border-[#1E293B] flex items-center gap-2">
                            <span className={`w-2 h-2 ${kpi.bullet} inline-block flex-shrink-0`}></span>
                            <span className="font-mono text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{kpi.meta}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* AI GOVERNANCE INSIGHT */}
                  {dashboard?.insight && (
                    <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl p-6 flex items-start gap-4 shadow-sm">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-700 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0">
                        <Icon name="sparkles" className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">এআই অগ্রাধিকার সারসংক্ষেপ · Suggested Priority Summary</div>
                        <p className="text-sm text-slate-700 dark:text-slate-200 mt-1 leading-relaxed">{dashboard.insight}</p>
                      </div>
                    </div>
                  )}

                  {/* QUEUE FILTERS */}
                  {['queue', 'map', 'review', 'proofs'].includes(adminView) && (
                    <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-7 shadow-sm space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-base font-bold text-slate-900 dark:text-white">Find and filter cases</h2>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Showing {filteredAdminReports.length} of {reports.length} municipal incidents</p>
                        </div>
                        <button onClick={resetQueueFilters} className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer">
                          Reset All Filters
                        </button>
                      </div>

                      <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
                        <input
                          type="search"
                          aria-label="Search incidents"
                          placeholder="Search ID, area, type…"
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          className="lg:col-span-2 rounded-xl px-4 py-3 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm"
                        />
                        <select aria-label="Reported within" value={queueFilters.days} onChange={e => setQueueFilters({ ...queueFilters, days: e.target.value })} className="rounded-xl px-3 py-3 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm">
                          <option value="all">Any age</option>
                          <option value="1">Last 24 hours</option>
                          <option value="7">Last 7 days</option>
                          <option value="15">Last 15 days</option>
                          <option value="30">Last 30 days</option>
                        </select>
                        <select aria-label="Work state" value={queueFilters.state} onChange={e => setQueueFilters({ ...queueFilters, state: e.target.value })} className="rounded-xl px-3 py-3 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm">
                          <option value="all">All statuses</option>
                          <option value="needs_action">Needs action</option>
                          <option value="assigned">Assigned</option>
                          <option value="unresolved">Unresolved</option>
                          <option value="resolved">Resolved</option>
                        </select>
                        <select aria-label="Category" value={queueFilters.category} onChange={e => setQueueFilters({ ...queueFilters, category: e.target.value })} className="rounded-xl px-3 py-3 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm">
                          <option value="all">All categories</option>
                          {reportCategories.map(category => <option key={category} value={category}>{category}</option>)}
                        </select>
                        <select aria-label="Severity" value={queueFilters.severity} onChange={e => setQueueFilters({ ...queueFilters, severity: e.target.value })} className="rounded-xl px-3 py-3 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 shadow-sm">
                          <option value="all">All severities</option>
                          {['Critical', 'High', 'Medium', 'Low'].map(level => <option key={level} value={level}>{level}</option>)}
                        </select>
                      </div>

                      <div className="flex items-center gap-2 pt-1 text-xs">
                        <span className="text-slate-500 dark:text-slate-400 font-semibold">Sort:</span>
                        {[
                          ['priority', 'Highest Priority'],
                          ['oldest', 'Oldest First'],
                          ['newest', 'Newest First']
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            onClick={() => setQueueFilters({ ...queueFilters, sort: value })}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                              queueFilters.sort === value
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SPATIAL MAP VIEW */}
                  {adminView === 'map' && (
                    <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm p-6 sm:p-8 space-y-4">
                      <div className="flex justify-between items-center">
                        <h2 className="text-base font-bold text-slate-900 dark:text-white">Filtered Incident Telemetry Map</h2>
                        <span className="text-xs text-slate-500 font-mono">{filteredAdminReports.filter(r => Number.isFinite(r.coordinates?.lat)).length} mapped coordinates</span>
                      </div>
                      <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                        <AuthorityMap reports={filteredAdminReports} useClusters={reportsTruncated} onSelect={report => { setSelectedReport(report); showToast(`${report.id}: ${report.status}`); }} />
                      </div>
                    </div>
                  )}

                  {/* WHATSAPP VIEW (Matching User's Reference Box Design) */}
                  {adminView === 'whatsapp' && (
                    <div className="space-y-6">
                      <div className="border border-[#1E293B] rounded-2xl overflow-hidden bg-[#0A101D] shadow-2xl">
                        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#1E293B]">
                          {[
                            { num: '01', label: 'Total WhatsApp Intake', value: reports.filter(r => r.channel === 'WhatsApp').length, icon: 'message-square', desc: 'Direct citizen conversational incident logs via WhatsApp bot gateway.', meta: 'AUTOMATED BOT INTAKE', numColor: 'text-[#38BDF8]', badgeBg: 'bg-[#0C243C] border-[#0284C7]/50 text-[#38BDF8]', bullet: 'bg-[#38BDF8]' },
                            { num: '02', label: 'Pending Triage', value: reports.filter(r => r.channel === 'WhatsApp' && r.status !== 'Resolved').length, icon: 'clock', desc: 'WhatsApp cases awaiting municipal dispatch routing or verification.', meta: 'ACTIVE DISPATCH QUEUE', numColor: 'text-amber-400', badgeBg: 'bg-amber-500/10 border-amber-500/40 text-amber-400', bullet: 'bg-amber-400' },
                            { num: '03', label: 'Resolved via Bot', value: reports.filter(r => r.channel === 'WhatsApp' && r.status === 'Resolved').length, icon: 'check-circle', desc: 'Incidents completed with photographic evidence verified by citizen.', meta: 'TWO-PARTY VERIFIED', numColor: 'text-[#10B981]', badgeBg: 'bg-[#082820] border-[#059669]/50 text-[#10B981]', bullet: 'bg-[#10B981]' }
                          ].map((stat, idx) => (
                            <div key={idx} className="p-6 sm:p-8 flex flex-col justify-between hover:bg-slate-900/50 transition-colors">
                              <div>
                                <div className="flex items-center justify-between mb-5">
                                  <span className={`font-headline text-3xl sm:text-4xl font-extrabold tracking-tight select-none leading-none ${stat.numColor}`}>
                                    {stat.value}
                                  </span>
                                  <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${stat.badgeBg}`}>
                                    <Icon name={stat.icon} className="w-5 h-5" />
                                  </div>
                                </div>
                                <h3 className="font-headline text-base font-bold text-white mb-2 tracking-tight">
                                  {stat.label}
                                </h3>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                  {stat.desc}
                                </p>
                              </div>
                              <div className="mt-8 pt-4 border-t border-[#1E293B] flex items-center gap-2">
                                <span className={`w-2 h-2 ${stat.bullet} inline-block flex-shrink-0`}></span>
                                <span className="font-mono text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{stat.meta}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CONTRACTORS VIEW */}
                  {adminView === 'contractors' && (
                    <div className="space-y-4">
                      {contractors.map(contractor => (
                        <div key={contractor.contractor_id} className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                          <div className="space-y-1">
                            <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold">{contractor.contractor_id}</div>
                            <div className="text-lg font-bold text-slate-900 dark:text-white">{contractor.name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                              {contractor.service_area} · {(contractor.skills || []).join(', ') || 'General Works'} · {contractor.approval_status || (contractor.verified ? 'Approved' : 'Pending Verification')}
                            </div>
                          </div>
                          {!contractor.verified && (
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => approveContractor(contractor, false)} className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 text-xs font-bold transition-colors">
                                Reject
                              </button>
                              <button onClick={() => approveContractor(contractor, true)} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all">
                                Approve Contractor
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ESCROW FUNDING VIEW */}
                  {adminView === 'funding' && (
                    <div className="space-y-6">
                      <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-8 shadow-sm">
                        <h2 className="text-base font-bold text-slate-900 dark:text-white">Community Repair Escrow Dispatch</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">Review applicant work plans, lock budget in escrow, inspect completion proof photos, and release funds.</p>
                      </div>
                      {repairRequests.length ? repairRequests.map(req => (
                        <div key={req.request_id} className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 sm:p-8 grid lg:grid-cols-[1fr_320px] gap-8 shadow-sm">
                          <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold">{req.request_id}</span>
                              <span className="text-xs font-mono text-slate-400">Incident: {req.complaint_id}</span>
                              <span className="px-3 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-xs font-semibold text-amber-700 dark:text-amber-400">{req.status}</span>
                            </div>
                            <div className="text-xl font-extrabold text-slate-900 dark:text-white">{req.applicant_name} · BDT {Number(req.estimated_price).toLocaleString()}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">Contact: {req.applicant_contact} · Est. Hours: {req.estimated_hours}h</div>
                            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
                              <div className="text-[11px] font-bold uppercase text-slate-400 mb-1">SUBMITTED WORK PLAN</div>
                              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{req.plan}</p>
                            </div>
                            {req.proof && (
                              <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-4 rounded-xl">
                                <img src={absoluteMediaUrl(req.proof.after_image_url)} className="w-24 h-20 object-cover rounded-xl border border-slate-200 dark:border-slate-700" alt="Completion proof" />
                                <div>
                                  <div className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">Youth completion photo uploaded</div>
                                  <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{req.proof.completion_note}</div>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="space-y-4">
                            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-5 space-y-1">
                              <div className="text-[11px] font-bold uppercase text-slate-400">ESCROW STATUS</div>
                              <div className="text-sm text-slate-900 dark:text-white font-medium">{req.funds_status}</div>
                              {req.approved_budget && <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono mt-2">BDT {Number(req.approved_budget).toLocaleString()}</div>}
                            </div>
                            {req.status === 'Pending Admin Review' && (
                              <>
                                <label className="block text-xs text-slate-600 dark:text-slate-300 font-medium">Approved Escrow Amount
                                  <input type="number" value={fundingBudgets[req.request_id] ?? req.estimated_price} onChange={e => setFundingBudgets({ ...fundingBudgets, [req.request_id]: e.target.value })} className="mt-1.5 w-full rounded-xl p-3 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-mono" />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <button onClick={() => decideRepair(req, false)} className="px-4 py-2.5 rounded-xl border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-950/20">Reject</button>
                                  <button onClick={() => decideRepair(req, true)} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm">Reserve Escrow</button>
                                </div>
                              </>
                            )}
                            {req.status === 'Approved - Awaiting Work' && (
                              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-4 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                                Waiting for youth worker on-site execution and after photo upload.
                              </div>
                            )}
                            {req.status === 'Proof Submitted - Awaiting Verification' && (
                              <button onClick={() => releaseFunds(req)} className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition-all">
                                ✓ Verify Proof & Release Funds
                              </button>
                            )}
                          </div>
                        </div>
                      )) : (
                        <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-12 text-center text-sm text-slate-500 dark:text-slate-400">
                          No community funding requests currently awaiting review.
                        </div>
                      )}
                    </div>
                  )}

                  {/* WORK QUEUE VIEW */}
                  {['queue', 'review', 'proofs'].includes(adminView) && (
                    <div className="bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden space-y-0">
                      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between bg-slate-50/60 dark:bg-slate-900/40">
                        <div className="flex items-center gap-2.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                          <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">{adminView === 'proofs' ? 'Contractor Proof Review' : adminView === 'review' ? 'Human Review Queue' : 'Municipal Incident Cadastre'}</h2>
                        </div>
                        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400">{displayedAdminReports.length} Active Records</span>
                      </div>

                      {/* INCIDENT WORKSPACE DRAWER */}
                      {(operationLoading || operationDetail) && (
                        <div className="border-b border-slate-200 dark:border-slate-700 p-6 sm:p-8 bg-slate-50/70 dark:bg-slate-900/60 reveal-up">
                          {operationLoading ? (
                            <div className="text-sm text-slate-500 font-mono">Loading incident workspace…</div>
                          ) : (
                            <div className="space-y-6">
                              <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                  <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold">INCIDENT WORKSPACE · {operationDetail.complaint.id}</div>
                                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">{operationDetail.complaint.title}</h3>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{operationDetail.complaint.location}</p>
                                </div>
                                <button onClick={() => setOperationDetail(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-2xl font-bold px-2 py-1">×</button>
                              </div>

                              <div className="grid lg:grid-cols-[280px_1fr] gap-6">
                                {operationDetail.complaint.beforeImage ? (
                                  <img src={operationDetail.complaint.beforeImage} alt="Citizen evidence" className="w-full h-56 object-cover rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm" />
                                ) : (
                                  <div className="h-56 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs text-slate-400">
                                    No photo evidence supplied
                                  </div>
                                )}
                                <div className="grid sm:grid-cols-2 gap-4 text-xs">
                                  <div className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
                                    <div className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">CITIZEN INPUT</div>
                                    <p className="text-slate-800 dark:text-slate-200 mt-2 leading-relaxed text-sm">{operationDetail.complaint.description}</p>
                                  </div>
                                  <div className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
                                    <div className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">AI VISION ASSESSMENT</div>
                                    <div className="text-slate-900 dark:text-white font-bold mt-2 text-sm">{operationDetail.complaint.category} · {operationDetail.complaint.severity}</div>
                                    <p className="text-slate-600 dark:text-slate-300 mt-1 text-xs leading-relaxed">{operationDetail.complaint.ai_reasoning || operationDetail.complaint.title}</p>
                                    <div className="text-emerald-600 dark:text-emerald-400 font-mono text-xs mt-2 font-semibold">Confidence: {operationDetail.complaint.confidence}</div>
                                  </div>
                                  <div className="sm:col-span-2 p-5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="text-slate-400 font-mono text-[10px] font-bold uppercase tracking-wider">ASSIGNED RESPONSIBLE AUTHORITY</div>
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                          {operationDetail.complaint.assigned_authority?.authority_data_status === 'gazette_verified' ? 'Gazette Verified' : 'Candidate Authority'}
                                        </span>
                                        {operationDetail.complaint.assigned_authority?.jurisdiction_data_status === 'statutory_polygon_verified' ? (
                                          <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                            Statutory Verified
                                          </span>
                                        ) : operationDetail.complaint.assigned_authority?.jurisdiction_data_status === 'heuristic_bbox' ? (
                                          <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                            Heuristic Area
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                            Location Inferred
                                          </span>
                                        )}
                                        {operationDetail.complaint.assigned_authority?.assignment_status === 'officer_assigned' && (
                                          <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                            Officer Assigned
                                          </span>
                                        )}
                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                                          Simulated Workflow
                                        </span>
                                      </div>
                                    </div>
                                    <div className="mt-1 text-slate-900 dark:text-white font-semibold flex items-center gap-2">
                                      <Icon name="building-2" className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                      <span>
                                        {operationDetail.complaint.assigned_authority?.authority_name
                                          ? `${operationDetail.complaint.assigned_authority.authority_name} (${operationDetail.complaint.assigned_authority.short_code})`
                                          : (operationDetail.complaint.needs_review || operationDetail.complaint.department === 'Needs Review' ? 'Awaiting Authority Review' : operationDetail.complaint.department)}
                                      </span>
                                    </div>
                                    {operationDetail.complaint.assigned_authority?.department && operationDetail.complaint.assigned_authority?.authority_name && (
                                      <div className="text-[11px] text-slate-500 dark:text-slate-400 pl-6">
                                        Department: <span className="text-slate-800 dark:text-slate-200 font-medium">{operationDetail.complaint.assigned_authority.department}</span>
                                      </div>
                                    )}
                                    {operationDetail.complaint.assigned_authority?.jurisdiction && (
                                      <div className="text-[11px] text-slate-500 dark:text-slate-400 pl-6 flex items-center gap-1.5">
                                        <Icon name="map-pin" className="w-3.5 h-3.5 text-emerald-600" />
                                        <span>Jurisdiction: {operationDetail.complaint.assigned_authority.jurisdiction}</span>
                                        {operationDetail.complaint.assigned_authority.routing_method && (
                                          <span className="font-mono text-[10px] text-slate-400">({operationDetail.complaint.assigned_authority.routing_method})</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="sm:col-span-2 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
                                    <div className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px] font-bold uppercase tracking-wider">RECOMMENDED NEXT ACTION</div>
                                    <p className="text-slate-800 dark:text-slate-200 mt-1 text-xs leading-relaxed">{operationDetail.recommended_action}</p>
                                  </div>
                                </div>
                              </div>

                              {/* SIMULATED FIELD OFFICER WORKFLOW CONTROLS */}
                              {(authUser?.role === 'officer' || authUser?.role === 'admin') && (
                                <div data-testid="officer-workflow-controls" className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 space-y-5 shadow-sm">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                                    <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                      <Icon name="briefcase" className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                      <span>SIMULATED FIELD OFFICER WORKFLOW</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                        Current Status: {operationDetail.complaint.status}
                                      </span>
                                      <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                        Simulated Demo
                                      </span>
                                    </div>
                                  </div>

                                  {/* Acknowledge Button */}
                                  {['Submitted', 'Assigned'].includes(operationDetail.complaint.status) && operationDetail.complaint.assigned_authority?.routing_status === 'assigned' && (
                                    <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
                                      <div>
                                        <div className="text-xs font-bold text-slate-900 dark:text-white">Step 1: Acknowledge Assignment</div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Confirm authority ownership and dispatch inspection crew.</div>
                                      </div>
                                      <button
                                        onClick={() => handleOfficerStatusUpdate('Acknowledged', 'Officer acknowledged incident and dispatched inspection team.')}
                                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                                      >
                                        <Icon name="check" className="w-4 h-4" />
                                        <span>Acknowledge Incident</span>
                                      </button>
                                    </div>
                                  )}

                                  {/* Reopened Incident Reinspection Card */}
                                  {operationDetail.complaint.status === 'Reopened - Needs Review' && (
                                    <div className="p-5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 space-y-3">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span className="text-amber-700 dark:text-amber-300 font-bold text-xs uppercase tracking-wider">Citizen Dispute · Reinspection Required</span>
                                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 font-bold">
                                            {operationDetail.complaint.citizen_verification?.outcome || 'not_fixed'}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                                        <span className="font-semibold text-slate-900 dark:text-white">Citizen feedback: </span>
                                        {operationDetail.complaint.citizen_verification?.note || operationDetail.complaint.review_reason || 'Citizen disputed resolution completion.'}
                                      </div>
                                      <div className="flex flex-wrap gap-2.5 pt-1">
                                        <button
                                          onClick={() => handleOfficerStatusUpdate('Acknowledged', 'Officer acknowledged citizen dispute and scheduled reinspection.')}
                                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <Icon name="check" className="w-4 h-4" />
                                          <span>Acknowledge Reinspection</span>
                                        </button>
                                        <button
                                          onClick={() => handleOfficerStatusUpdate('In Progress', 'Field team deployed to address citizen dispute.')}
                                          className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <Icon name="play" className="w-4 h-4" />
                                          <span>Resume Field Work</span>
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Start Work Button */}
                                  {operationDetail.complaint.status === 'Acknowledged' && (
                                    <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
                                      <div>
                                        <div className="text-xs font-bold text-slate-900 dark:text-white">Step 2: Mobilize Crew & Start Work</div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Deploy maintenance equipment to site.</div>
                                      </div>
                                      <button
                                        onClick={() => handleOfficerStatusUpdate('In Progress', 'Field maintenance team deployed to site.')}
                                        className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                                      >
                                        <Icon name="play" className="w-4 h-4" />
                                        <span>Start Field Work</span>
                                      </button>
                                    </div>
                                  )}

                                  {/* In Progress Controls: Progress Note & Evidence Upload */}
                                  {['In Progress', 'Resolution Submitted'].includes(operationDetail.complaint.status) && (
                                    <div className="space-y-4 pt-1">
                                      {/* Progress Note Form */}
                                      <div className="space-y-1.5">
                                        <label className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase">Field Progress Note</label>
                                        <div className="flex gap-2">
                                          <input
                                            type="text"
                                            placeholder="Add progress note (e.g. materials arriving at 2 PM)..."
                                            value={officerProgressNote}
                                            onChange={(e) => setOfficerProgressNote(e.target.value)}
                                            className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-2.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                          />
                                          <button
                                            onClick={handleOfficerProgressUpdate}
                                            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all shrink-0 cursor-pointer"
                                          >
                                            Add Note
                                          </button>
                                        </div>
                                      </div>

                                      {/* Upload Resolution Evidence Form */}
                                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 p-4 space-y-3">
                                        <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                                          <Icon name="camera" className="w-3.5 h-3.5" />
                                          <span>Upload Completed Resolution Proof</span>
                                        </div>
                                        <div className="grid sm:grid-cols-2 gap-3">
                                          <div>
                                            <label className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 mb-1 uppercase">Completion Photograph</label>
                                            <input
                                              type="file"
                                              accept="image/*"
                                              onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                                              className="w-full text-xs text-slate-500 dark:text-slate-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 dark:file:bg-emerald-950/50 file:text-emerald-700 dark:file:text-emerald-300 hover:file:bg-emerald-100 cursor-pointer"
                                            />
                                          </div>
                                          <div>
                                            <label className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 mb-1 uppercase">Completion Notes</label>
                                            <textarea
                                              rows={2}
                                              placeholder="Describe work performed on site..."
                                              value={evidenceNote}
                                              onChange={(e) => setEvidenceNote(e.target.value)}
                                              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-xs text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                            />
                                          </div>
                                        </div>
                                        <button
                                          disabled={!evidenceFile || !evidenceNote.trim() || isUploadingEvidence}
                                          onClick={handleEvidenceUpload}
                                          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                                        >
                                          {isUploadingEvidence ? (
                                            <span>Uploading & Verifying Image…</span>
                                          ) : (
                                            <>
                                              <Icon name="upload" className="w-3.5 h-3.5" />
                                              <span>Submit Resolution Evidence for Citizen Verification</span>
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* If already in Evidence Uploaded or Verification */}
                                  {['Evidence Uploaded', 'Verification'].includes(operationDetail.complaint.status) && (
                                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <span className="text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-2">
                                        <Icon name="clock" className="w-4 h-4 text-emerald-600" />
                                        <span>Evidence submitted. Awaiting citizen confirmation gate.</span>
                                      </span>
                                      {operationDetail.complaint.afterImage && (
                                        <a href={operationDetail.complaint.afterImage} target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 font-medium text-xs hover:underline">
                                          View proof photo ↗
                                        </a>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="grid lg:grid-cols-2 gap-6 pt-2">
                                <div>
                                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">MATCHED CONTRACTORS</div>
                                  <div className="flex gap-2">
                                    <select value={offerForm.contractor_id} onChange={e => setOfferForm({ ...offerForm, contractor_id: e.target.value })} className="min-w-0 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500">
                                      {operationDetail.contractor_matches.map(c => <option key={c.contractor_id} value={c.contractor_id} className="bg-white dark:bg-slate-800">{c.name} · {c.match_score}% Match · ★{c.rating}</option>)}
                                    </select>
                                    <input type="number" placeholder="Budget BDT" value={offerForm.budget_cap} onChange={e => setOfferForm({ ...offerForm, budget_cap: e.target.value })} className="w-28 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500" />
                                    <button disabled={operationDetail.complaint.needs_review || operationDetail.offers.some(o => ['Sent','Accepted','In Progress','Proof Submitted','Approved'].includes(o.status))} onClick={assignContractor} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer">Dispatch Order</button>
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">ACTIVE WORK ORDERS</div>
                                  {operationDetail.offers.length ? (
                                    <div className="space-y-3">
                                      {operationDetail.offers.map(offer => (
                                        <div key={offer.offer_id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-xl text-xs shadow-sm">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                              <span className="text-slate-900 dark:text-white font-bold">{offer.contractor_name}</span>
                                              <span className="text-slate-500 dark:text-slate-400"> · BDT {Number(offer.budget_cap).toLocaleString()}</span>
                                            </div>
                                            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${offer.status === 'Proof Submitted' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200' : offer.status === 'Approved' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>{offer.status}</span>
                                          </div>
                                          {offer.status === 'Proof Submitted' && (
                                            <div className="mt-3 grid sm:grid-cols-[88px_1fr] gap-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 p-3">
                                              {offer.after_image_url && <img src={absoluteMediaUrl(offer.after_image_url)} alt="Contractor completion evidence" className="h-20 w-full rounded-lg object-cover border border-slate-200 dark:border-slate-700" />}
                                              <div className="space-y-2 min-w-0">
                                                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{offer.note || 'Completion proof submitted for final review.'}</p>
                                                <a href={offer.report_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"><Icon name="external-link" className="w-3.5 h-3.5" />Open public Drive report</a>
                                                <div className="flex flex-wrap gap-2 pt-1">
                                                  <button onClick={() => changeOfferStatus(offer, 'In Progress', 'Final review requested changes; contractor must resubmit proof.')} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-100 transition-all cursor-pointer">Request changes</button>
                                                  <button onClick={() => changeOfferStatus(offer, 'Approved', 'Final proof approved; contractor payment released.')} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-all shadow-sm cursor-pointer">Approve & release payment</button>
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                          {offer.status === 'Approved' && <div className="mt-2 flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold"><Icon name="circle-check" className="w-4 h-4" /><span>Final review approved · Payment released</span></div>}
                                          <div className="flex gap-2 mt-2">
                                            {offer.status === 'Sent' && <button onClick={() => changeOfferStatus(offer, 'Accepted')} className="px-3 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold cursor-pointer">Accept</button>}
                                            {offer.status === 'Accepted' && <button onClick={() => changeOfferStatus(offer, 'In Progress')} className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer">Start</button>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-400 font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-xl shadow-sm">No contractor assigned yet.</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* DATA TABLE */}
                      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              <th className="py-4 px-6">ID</th>
                              <th className="py-4 px-6">Category & Location</th>
                              <th className="py-4 px-6">Severity</th>
                              <th className="py-4 px-6">AI Confidence</th>
                              <th className="py-4 px-6">Status</th>
                              <th className="py-4 px-6 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                            {displayedAdminReports.map((item) => (
                              <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                <td className="py-4 px-6 font-mono font-bold text-emerald-600 dark:text-emerald-400">{item.id}</td>
                                <td className="py-4 px-6">
                                  <div className="font-semibold text-slate-900 dark:text-white">{item.category}</div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">{item.location}</div>
                                  {item.assigned_authority?.short_code && (
                                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                                      {item.assigned_authority.short_code} • {item.assigned_authority.department || item.department}
                                    </div>
                                  )}
                                </td>
                                <td className="py-4 px-6">
                                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${item.severity === 'Critical'
                                      ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                                      : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                    }`}>
                                    {item.severity}
                                  </span>
                                </td>
                                <td className="py-4 px-6 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                  {item.confidence}
                                </td>
                                <td className="py-4 px-6">
                                  <span className="text-slate-700 dark:text-slate-300 font-medium font-mono">{item.status}</span>
                                </td>
                                <td className="py-4 px-6 text-right">
                                  <div className="flex justify-end gap-2">
                                    {((item.needs_review && item.review_type === 'routing_uncertain') || item.status === 'Needs Review') && (
                                      authUser?.role === 'admin' ? (
                                        <button onClick={() => setReviewReport(item)} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs transition-all shadow-sm cursor-pointer">Review AI</button>
                                      ) : (
                                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[10px] font-semibold uppercase">Admin Review</span>
                                      )
                                    )}
                                    {item.status === 'Reopened - Needs Review' && (
                                      <span className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase">Disputed</span>
                                    )}
                                    <button
                                      disabled={!nextOperationalStatus(item) || (item.needs_review && item.review_type === 'routing_uncertain') || item.status === 'Needs Review'}
                                      onClick={() => nextOperationalStatus(item) && updateStatus(item, nextOperationalStatus(item))}
                                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-30 font-semibold text-xs transition-all shadow-sm cursor-pointer"
                                    >
                                      {nextOperationalStatus(item) ? `→ ${nextOperationalStatus(item)}` : 'Await proof'}
                                    </button>
                                    <button
                                      onClick={() => inspectIncident(item)}
                                      className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs transition-all cursor-pointer"
                                    >
                                      Workspace
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {!displayedAdminReports.length && (
                              <tr>
                                <td colSpan="6" className="py-12 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
                                  No incidents match the active filter criteria.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            )}

          </main>

          {/* FOOTER */}
          <footer className="w-full bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-8 mb-16 lg:mb-0 transition-colors">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-md bg-emerald-600 flex items-center justify-center text-white">
                    <Icon name="check" className="w-3 h-3 stroke-[3]" />
                  </div>
                  <span className="font-bold text-slate-900 dark:text-white uppercase">UrbanFix Civic Ledger</span>
                  <span className="text-slate-400">v4.8.2-CIV</span>
                </div>
                <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10B981]"></span>
                  <span className="uppercase text-slate-600 dark:text-slate-300">Telemetry: Nominal</span>
                </div>
                <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  <span className="uppercase text-slate-600 dark:text-slate-300">Dispatch Queue: Normal</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
                <button onClick={() => setActiveTab('community')} className="text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Community cleanup</button>
                <button onClick={() => setActiveTab('contractor')} className="text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Contractor portal</button>
                <span className="text-slate-400">© 2026 Civil Works Authority</span>
              </div>
            </div>
          </footer>
          <ReviewDialog report={reviewReport} busy={reviewBusy} onClose={() => !reviewBusy && setReviewReport(null)} onConfirm={confirmHumanReview} />
        </div>
      );
    }
