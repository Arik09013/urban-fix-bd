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
        <div className="max-w-xl mx-auto bg-surface-clean border-2 border-border-black shadow-[6px_6px_0px_var(--shadow-color)] rounded-lg p-6 sm:p-8 space-y-6">
          <div className="text-left border-b-2 border-border-black/30 pb-4">
            <div className="inline-flex items-center gap-2 bg-surface-container border border-border-black px-2.5 py-1 text-[10px] font-mono font-bold uppercase text-accent-electric-cyan mb-2 shadow-[2px_2px_0px_var(--shadow-color)]">
              <span className="w-2 h-2 rounded-full bg-status-live-green"></span>
              <span>// MUNICIPAL ACCESS GATE</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black font-headline uppercase text-ink-primary tracking-tight">{title}</h2>
            <p className="text-xs sm:text-sm text-ink-secondary mt-1 leading-relaxed">{subtitle}</p>
          </div>

          {allowRegister && (
            <div className="grid grid-cols-2 bg-surface-container border-2 border-border-black rounded-lg p-1">
              <button onClick={()=>setMode('login')} className={`py-2 rounded text-xs font-mono font-bold uppercase transition-all cursor-pointer ${mode==='login'?'bg-primary-container text-on-primary-container shadow-[2px_2px_0px_var(--shadow-color)]':'text-ink-secondary hover:text-ink-primary'}`}>Login</button>
              <button onClick={()=>setMode('register')} className={`py-2 rounded text-xs font-mono font-bold uppercase transition-all cursor-pointer ${mode==='register'?'bg-primary-container text-on-primary-container shadow-[2px_2px_0px_var(--shadow-color)]':'text-ink-secondary hover:text-ink-primary'}`}>Register</button>
            </div>
          )}

          {/* CREDENTIAL INPUTS - FRONT & CENTER */}
          <div className="space-y-4">
            {allowRegister && mode==='register' && (
              <>
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-ink-secondary mb-1">Full Name</label>
                  <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name" autoComplete="name" className="w-full glass-input rounded-lg p-3 text-sm focus:outline-none"/>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-ink-secondary mb-1">Phone Number (optional)</label>
                  <input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="Phone number (optional)" autoComplete="tel" className="w-full glass-input rounded-lg p-3 text-sm focus:outline-none"/>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold uppercase text-ink-secondary mb-1">Stripe Payout Account (optional)</label>
                  <input value={form.payoutAccount || ''} onChange={e=>setForm({...form,payoutAccount:e.target.value})} placeholder="Stripe Connect account for payments (acct_…)" className="w-full glass-input rounded-lg p-3 text-sm focus:outline-none"/>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-mono font-bold uppercase text-ink-secondary mb-1.5 flex items-center justify-between">
                <span>{allowRegister ? 'Email Address' : 'Admin / Officer Username'}</span>
                {!allowRegister && <span className="text-[10px] text-accent-electric-cyan font-normal font-mono">e.g. admin or officer.ccc</span>}
              </label>
              <input 
                type={allowRegister ? 'email' : 'text'} 
                value={form.email} 
                onChange={e => setForm({...form, email: e.target.value})} 
                placeholder={allowRegister ? 'Email address' : 'Admin username'} 
                autoComplete="username" 
                className="w-full glass-input rounded-lg p-3 text-sm text-ink-primary bg-surface-clean border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-mono font-bold uppercase text-ink-secondary mb-1.5 flex items-center justify-between">
                <span>Security Credential / Password</span>
                {!allowRegister && <span className="text-[10px] text-accent-electric-cyan font-normal font-mono">admin or demo password</span>}
              </label>
              <div className="relative">
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={form.password} 
                  onChange={e => setForm({...form, password: e.target.value})} 
                  placeholder="Password" 
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'} 
                  onKeyDown={e => e.key === 'Enter' && canSubmit && submit()} 
                  className="w-full glass-input rounded-lg p-3 pr-16 text-sm text-ink-primary bg-surface-clean border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] focus:outline-none"
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(value => !value)} 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-ink-secondary hover:text-accent-electric-cyan cursor-pointer px-1 py-0.5"
                >
                  {showPassword ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            {registering && (
              <div>
                <label className="block text-xs font-mono font-bold uppercase text-ink-secondary mb-1.5">Confirm Password</label>
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={form.confirmPassword} 
                  onChange={e => setForm({...form, confirmPassword: e.target.value})} 
                  placeholder="Confirm password" 
                  autoComplete="new-password" 
                  onKeyDown={e => e.key === 'Enter' && canSubmit && submit()} 
                  className={`w-full glass-input rounded-lg p-3 text-sm text-ink-primary bg-surface-clean border-2 shadow-[2px_2px_0px_var(--shadow-color)] focus:outline-none ${form.confirmPassword && !passwordsMatch ? 'border-red-500' : 'border-border-black'}`}
                />
                <div className="flex justify-between text-[10px] font-mono px-1 mt-1">
                  <span className={passwordValid ? 'text-status-live-green' : 'text-ink-subtle'}>{passwordValid ? '✓ 8+ chars' : 'Min 8 characters'}</span>
                  {form.confirmPassword && <span className={passwordsMatch ? 'text-status-live-green' : 'text-red-400'}>{passwordsMatch ? '✓ Passwords match' : 'Passwords do not match'}</span>}
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-lg border-2 border-red-500 bg-red-500/10 p-3 text-xs text-red-400 font-mono flex items-center gap-2">
                <Icon name="alert-circle" className="w-4 h-4 text-red-400 shrink-0"/>
                <span>{error}</span>
              </div>
            )}

            <button 
              onClick={() => submit()} 
              disabled={!canSubmit} 
              className="w-full py-3.5 rounded-lg bg-primary-container text-on-primary-container font-mono font-black uppercase text-sm border-2 border-border-black shadow-[4px_4px_0px_var(--shadow-color)] hover:shadow-[2px_2px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Icon name="shield-check" className="w-4 h-4 text-on-primary-container" />
              <span>{busy ? 'AUTHENTICATING…' : mode === 'register' ? 'CREATE ACCOUNT →' : 'AUTHENTICATE & ENTER PORTAL →'}</span>
            </button>
          </div>

          {/* QUICK DEMO LOGIN SHORTCUTS - PLACED CONVENIENTLY BELOW */}
          {demoCredentials && (
            <div className="border-t-2 border-border-black/30 pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold uppercase text-ink-secondary">// FAST DEMO LOGINS (ONE-CLICK FILL)</span>
                <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 border border-status-warning-amber text-status-warning-amber bg-status-warning-amber/10 font-bold">HACKATHON EVALUATORS</span>
              </div>

              <button 
                type="button" 
                onClick={() => setForm({...form, email: 'admin', password: 'admin'})} 
                className="w-full rounded-lg border-2 border-border-black bg-surface-container p-3 text-left hover:bg-surface-clean shadow-[2px_2px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all cursor-pointer flex items-center justify-between gap-3 group"
              >
                <div>
                  <div className="font-bold text-xs text-ink-primary font-mono group-hover:text-accent-electric-cyan transition-colors">
                    ⚡ Judge demo access (Administrator)
                  </div>
                  <div className="font-mono text-[11px] text-ink-secondary mt-0.5">
                    Fills: <span className="font-bold text-ink-primary">username: admin</span> · <span className="font-bold text-ink-primary">password: admin</span>
                  </div>
                </div>
                <span className="shrink-0 text-[10px] uppercase font-mono px-2 py-1 border border-border-black bg-primary-container text-on-primary-container font-black">
                  FILL ADMIN
                </span>
              </button>

              <div className="p-3 rounded-lg border-2 border-border-black bg-surface-container space-y-2">
                <div className="text-[10px] font-mono uppercase text-ink-secondary font-bold flex items-center justify-between">
                  <span>Simulated City Corporation Officers (One-Click Log In)</span>
                  <span className="text-[9px] text-accent-electric-cyan font-mono">Instant Session</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { code: 'officer.ccc', label: 'CCC (Chattogram)', auth: 'AUTH-CCC' },
                    { code: 'officer.dncc', label: 'DNCC (Dhaka N)', auth: 'AUTH-DNCC' },
                    { code: 'officer.dscc', label: 'DSCC (Dhaka S)', auth: 'AUTH-DSCC' },
                    { code: 'officer.dwasa', label: 'DWASA (Water/Sewer)', auth: 'AUTH-DWASA' },
                  ].map(item => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => onDemoOfficerLogin ? onDemoOfficerLogin(item.code) : setForm({...form, email: item.code})}
                      className="rounded border-2 border-border-black bg-surface-clean p-2 text-left text-[11px] text-ink-primary hover:bg-primary-container hover:text-on-primary-container shadow-[2px_2px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all cursor-pointer"
                    >
                      <div className="font-bold truncate text-xs">{item.label}</div>
                      <div className="font-mono text-[10px] text-ink-secondary">{item.code}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // --- MAIN APP COMPONENT ---
    export default function App() {
      const [activeTab, setActiveTab] = useState('landing');
      const [darkMode, setDarkMode] = useState(() => localStorage.getItem('urbanfix-theme') !== 'light');
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
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', darkMode ? '#0B0F17' : '#f5f5f7');
      }, [darkMode]);

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

          {/* TOP CADASTRE TICKER RIBBON */}
          <div className="w-full bg-[#070A11] text-slate-200 border-b-2 border-border-black py-1.5 px-4 overflow-hidden whitespace-nowrap">
            <div className="inline-flex items-center gap-6 font-mono text-xs uppercase tracking-wider animate-pulse">
              <span className="flex items-center gap-2 text-slate-100 font-semibold">
                <span className="w-2 h-2 rounded-full bg-status-live-green inline-block shadow-[0_0_8px_#10B981]"></span>
                DISPATCH STATUS: ACTIVE · WARD NETWORK MONITORING
              </span>
              <span className="text-slate-600">/</span>
              <span className="text-accent-electric-cyan font-bold">NO APP DOWNLOAD REQUIRED</span>
              <span className="text-slate-600">/</span>
              <span className="text-slate-300">AVERAGE VERIFICATION TIME: 4.2 HRS</span>
              <span className="text-slate-600">/</span>
              <span className="text-status-warning-amber font-bold">CURRENT INCIDENT LOAD: {reports.length} OPEN CADASTRES</span>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400">OPEN CIVIC LEDGER 2026</span>
            </div>
          </div>

          {/* HEADER / NAVIGATION */}
          <header className="sticky top-0 z-50 bg-surface border-b-2 border-border-black">
            <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between gap-6">
              <div className="flex items-center gap-4 lg:gap-6">
                <button aria-label="UrbanFix home" className="flex shrink-0 items-center gap-2.5 text-left focus:outline-none cursor-pointer" onClick={() => setActiveTab('landing')}>
                  <div className="w-8 h-8 bg-primary-container border-2 border-border-black flex items-center justify-center shadow-[2px_2px_0px_var(--shadow-color)]">
                    <Icon name="check" className="w-5 h-5 text-on-primary-container stroke-[3]" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-headline font-black text-lg uppercase tracking-tight text-ink-primary leading-none">UrbanFix</span>
                    <span className="font-mono text-[9px] text-ink-subtle uppercase tracking-wider">Civic Engine</span>
                  </div>
                </button>
                <div className="hidden xl:flex items-center gap-2 px-3 py-1 bg-surface-container border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)]">
                  <span className="w-2 h-2 rounded-full bg-status-live-green shadow-[0_0_6px_#10B981]"></span>
                  <span className="font-mono text-[10px] uppercase font-bold text-ink-primary tracking-wider">CADASTRE-SYNC: LIVE</span>
                </div>
              </div>

              <nav className="hidden md:flex items-center gap-2 lg:gap-3 font-mono text-xs uppercase font-bold tracking-wide">
                {[
                  { id: 'landing', label: 'Home' },
                  { id: 'report', label: 'Report Issue' },
                  { id: 'track', label: 'Track Report' },
                  { id: 'map', label: 'Public Map' },
                ].map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { if (tab.id === 'track') { setSelectedReport(null); setSubmittedReportId(''); } setActiveTab(tab.id); }}
                      aria-current={isActive ? 'page' : undefined}
                      className={`px-4 py-2 border-2 transition-all cursor-pointer ${
                        isActive 
                          ? 'bg-primary-container text-on-primary-container font-black border-border-black shadow-[2px_2px_0px_var(--shadow-color)]'
                          : 'border-transparent text-ink-secondary hover:border-border-black hover:bg-surface-container hover:text-ink-primary'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              <div className="flex shrink-0 items-center gap-3">
                <button 
                  onClick={() => setDarkMode(value => !value)} 
                  aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} 
                  title={`Switch to ${darkMode ? 'light' : 'dark'} mode`} 
                  className="w-9 h-9 border-2 border-border-black bg-surface-clean text-ink-primary hover:bg-surface-container flex items-center justify-center shadow-[2px_2px_0px_var(--shadow-color)] transition-colors cursor-pointer"
                >
                  <Icon name={darkMode ? 'sun' : 'moon'} className="w-4 h-4 text-accent-electric-cyan" />
                </button>

                <button 
                  onClick={() => setActiveTab('admin')}
                  aria-label="Authority Portal"
                  className={`px-3.5 py-2 font-mono text-xs font-bold border-2 border-border-black transition-all flex items-center gap-2 cursor-pointer shadow-[2px_2px_0px_var(--shadow-color)] ${
                    activeTab === 'admin'
                      ? 'bg-primary-container text-on-primary-container font-black'
                      : 'bg-surface-clean hover:bg-primary-container hover:text-on-primary-container text-ink-primary'
                  }`}
                >
                  <Icon name="shield-alert" className={`w-4 h-4 ${activeTab === 'admin' ? 'text-on-primary-container' : 'text-accent-electric-cyan'}`} />
                  <span className="hidden sm:inline">Authority Portal</span>
                </button>
              </div>
            </div>
          </header>

          {/* MOBILE BOTTOM NAVIGATION */}
          <nav aria-label="Mobile navigation" className="mobile-nav lg:hidden fixed bottom-0 inset-x-0 z-50 bg-surface border-t-2 border-border-black px-2 py-1.5 grid grid-cols-4 shadow-[0_-4px_0px_var(--shadow-color)]">
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
                  className={`min-w-0 min-h-12 border-2 flex flex-col items-center justify-center gap-0.5 py-1 font-mono text-[10px] font-bold uppercase transition-all ${
                    isActive ? 'bg-primary-container text-on-primary-container border-border-black shadow-[2px_2px_0px_var(--shadow-color)]' : 'border-transparent text-ink-secondary hover:text-ink-primary'
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
              <div className="bg-surface-clean border-2 border-border-black text-ink-primary px-4 py-3 shadow-[4px_4px_0px_var(--shadow-color)] flex items-center gap-3">
                <Icon name="activity" className="w-4 h-4 text-accent-electric-cyan shrink-0" />
                <span className="font-mono text-xs font-semibold leading-snug">{toast}</span>
              </div>
            </div>
          )}

          {/* MAIN BODY ROUTING */}
          <main id="main-content" className="flex-1" tabIndex="-1">
            {/* 1. LANDING PAGE */}
            {activeTab === 'landing' && (
              <div className="flex flex-col w-full">
                {/* HERO SECTION */}
                <section aria-labelledby="hero-title" className="w-full border-b-2 border-border-black bg-surface py-12 md:py-20">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
                      {/* Left Column: Primary Messaging & Trigger Actions */}
                      <div className="lg:col-span-7 flex flex-col justify-between">
                        <div className="flex flex-col">
                          {/* Classification Badge */}
                          <div className="inline-flex items-center gap-2 self-start bg-surface-container border-2 border-border-black px-3 py-1 shadow-[2px_2px_0px_var(--shadow-color)] mb-4">
                            <span className="font-mono text-xs font-bold text-ink-primary uppercase tracking-wider">// OPEN CIVIC ENGINE</span>
                            <span className="w-1.5 h-1.5 bg-accent-electric-cyan"></span>
                            <span className="font-mono text-xs text-ink-secondary uppercase">MUNICIPAL PORTAL</span>
                          </div>

                          {/* Massive Punchy Headline */}
                          <h1 id="hero-title" className="font-headline text-3xl sm:text-5xl lg:text-6xl font-black text-ink-primary tracking-tight leading-[1.1] mb-4">
                            See a problem in your area?<br/>
                            <span className="inline-block mt-2 bg-primary-container text-on-primary-container px-3 py-1 border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)]">
                              Report it here.
                            </span>
                          </h1>

                          {/* Subtext */}
                          <p className="text-base sm:text-lg text-ink-secondary max-w-xl mb-6 leading-relaxed">
                            Take a photo, share the location, and track what happens next. You do not need an account or identity pre-registration.
                          </p>

                          {/* Action CTAs with Neo-Brutalist hard offsets */}
                          <div className="flex flex-wrap items-center gap-4 mb-8">
                            <button 
                              onClick={() => { setReportStep(1); setActiveTab('report'); }}
                              className="inline-flex items-center justify-center gap-2 bg-primary-container text-on-primary-container font-mono text-sm uppercase font-bold border-2 border-border-black px-6 py-3 shadow-[4px_4px_0px_var(--shadow-color)] hover:shadow-[2px_2px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px] transition-all cursor-pointer" 
                              data-path="report-issue"
                            >
                              <Icon name="camera" className="w-5 h-5 text-on-primary-container" />
                              <span>Report an Issue →</span>
                            </button>
                            <button 
                              onClick={() => { setSelectedReport(null); setTrackingError(''); setActiveTab('track'); }}
                              className="inline-flex items-center justify-center gap-2 bg-surface-clean text-ink-primary font-mono text-sm uppercase font-bold border-2 border-border-black px-6 py-3 shadow-[4px_4px_0px_var(--shadow-color)] hover:bg-surface-container hover:shadow-[2px_2px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[4px] active:translate-y-[4px] transition-all cursor-pointer" 
                              data-path="track-report"
                            >
                              <Icon name="search" className="w-5 h-5 text-accent-electric-cyan" />
                              <span>Track a Report</span>
                            </button>
                          </div>

                          {/* Trust / Value Proposition Checklist */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t-2 border-border-black/30">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 bg-status-live-green/20 border border-status-live-green/50 text-status-live-green flex items-center justify-center text-xs font-bold">✓</div>
                              <span className="font-mono text-xs uppercase text-ink-primary font-bold">No account needed</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 bg-status-live-green/20 border border-status-live-green/50 text-status-live-green flex items-center justify-center text-xs font-bold">✓</div>
                              <span className="font-mono text-xs uppercase text-ink-primary font-bold">Get a report ID</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 bg-status-live-green/20 border border-status-live-green/50 text-status-live-green flex items-center justify-center text-xs font-bold">✓</div>
                              <span className="font-mono text-xs uppercase text-ink-primary font-bold">See proof when fixed</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Featured Public Report Card */}
                      <div className="lg:col-span-5 w-full">
                        <div className="bg-surface-clean border-2 border-border-black shadow-[6px_6px_0px_var(--shadow-color)] flex flex-col relative">
                          {/* Card Header Ribbon */}
                          <div className="bg-surface-container border-b-2 border-border-black px-4 py-2.5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon name="globe" className="w-4 h-4 text-accent-electric-cyan" />
                              <span className="font-mono text-xs uppercase font-bold text-ink-primary">A Public Report</span>
                            </div>
                            <span className="bg-primary-container text-on-primary-container font-mono text-[10px] uppercase font-bold px-2 py-0.5 border border-border-black">
                              Live Cadastre
                            </span>
                          </div>

                          {/* Card Visual Evidence / Image container */}
                          <div className="relative border-b-2 border-border-black h-48 bg-surface-container-high overflow-hidden group">
                            <img 
                              className="w-full h-full object-cover grayscale contrast-125 group-hover:grayscale-0 transition-all duration-300" 
                              alt="Civic report evidence"
                              src={featuredReport?.beforeImage || featuredReport?.image_url || "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800"} 
                            />
                            <div className="absolute bottom-2 left-2 bg-surface-container/90 border border-border-black text-ink-primary px-2 py-1 font-mono text-[10px] uppercase flex items-center gap-1.5 backdrop-blur-sm">
                              <Icon name="camera" className="w-3.5 h-3.5 text-accent-electric-cyan" />
                              <span>PHOTO-LOG #{featuredReport?.id || '4092-B'}</span>
                            </div>
                          </div>

                          {/* Incident Details */}
                          <div className="p-4 flex flex-col gap-3 bg-surface-clean">
                            <div className="flex items-center justify-between">
                              {/* Status Pill */}
                              <div className="inline-flex items-center gap-1.5 bg-surface-container border border-border-black px-2.5 py-0.5">
                                <span className={`w-2 h-2 rounded-full ${featuredReport?.status === 'Resolved' ? 'bg-status-live-green shadow-[0_0_6px_#10B981]' : 'bg-status-warning-amber animate-ping'}`}></span>
                                <span className="font-mono text-[10px] uppercase font-bold text-ink-primary">{featuredReport?.status || 'In Progress'}</span>
                              </div>
                              <span className="font-mono text-[10px] text-ink-subtle uppercase">LOGGED: RECENT</span>
                            </div>

                            {/* Incident Title and Description */}
                            <h2 className="font-headline text-sm font-bold text-ink-primary leading-snug line-clamp-2">
                              {featuredReport?.title || 'Severe waterlogging and overflow along Muradpur main road following morning rainfall.'}
                            </h2>

                            {/* Location Tag Meta */}
                            <div className="flex items-center gap-1.5 bg-surface-container border border-border-black px-3 py-1.5 text-xs">
                              <Icon name="map-pin" className="w-3.5 h-3.5 text-accent-electric-cyan shrink-0" />
                              <span className="font-mono text-[11px] uppercase text-ink-primary font-bold truncate">
                                {featuredReport?.location || 'Muradpur Junction, Ward 08'}
                              </span>
                            </div>

                            {/* Metadata Key-Value Spec Grid */}
                            <div className="grid grid-cols-2 gap-2 border-t border-border-black/30 pt-2 font-mono text-[10px]">
                              <div>
                                <span className="text-ink-subtle uppercase block">Report ID:</span>
                                <span className="font-bold text-ink-primary">#{featuredReport?.id || 'UF-2026-0841'}</span>
                              </div>
                              <div>
                                <span className="text-ink-subtle uppercase block">Dept Routed:</span>
                                <span className="font-bold text-ink-primary truncate block">{featuredReport?.department || 'Road Maintenance'}</span>
                              </div>
                            </div>

                            {/* Card Action Button */}
                            <div className="mt-1 pt-2 border-t-2 border-border-black">
                              <button 
                                onClick={() => setActiveTab('map')} 
                                className="w-full flex items-center justify-between bg-surface-container hover:bg-primary-container hover:text-on-primary-container text-ink-primary px-3 py-2 border border-border-black transition-colors font-mono text-xs uppercase font-bold cursor-pointer"
                              >
                                <span>View public reports</span>
                                <Icon name="arrow-right" className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* "HOW IT WORKS" SECTION */}
                <section aria-labelledby="workflow-title" className="w-full bg-canvas-paper py-12 md:py-20 border-b-2 border-border-black">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    {/* Section Header */}
                    <div className="max-w-3xl mb-10">
                      <div className="font-mono text-xs text-accent-electric-cyan uppercase tracking-widest mb-1 font-bold">
                        // HOW IT WORKS
                      </div>
                      <h2 id="workflow-title" className="font-headline text-3xl sm:text-4xl font-black text-ink-primary tracking-tight mb-2">
                        Report. Track. Verify.
                      </h2>
                      <p className="text-base text-ink-secondary">
                        A simple process, with a clear record at every step.
                      </p>
                    </div>

                    {/* Clean 3-Column Minimal Grid with 2px borders */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-2 border-border-black bg-surface-clean shadow-[6px_6px_0px_var(--shadow-color)]">
                      {/* Column 01: Report */}
                      <div className="p-6 md:p-8 border-b-2 md:border-b-0 md:border-r-2 border-border-black flex flex-col justify-between hover:bg-surface-container transition-colors">
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <span className="font-headline text-4xl text-accent-electric-cyan font-black select-none leading-none">
                              01
                            </span>
                            <div className="w-9 h-9 bg-primary-container border-2 border-border-black flex items-center justify-center shadow-[2px_2px_0px_var(--shadow-color)]">
                              <Icon name="camera" className="w-5 h-5 text-on-primary-container" />
                            </div>
                          </div>
                          <h3 className="font-headline text-xl font-bold text-ink-primary mb-2 tracking-tight">
                            Report
                          </h3>
                          <p className="text-sm text-ink-secondary leading-relaxed">
                            Take or upload a photo, add the location, and briefly describe the problem.
                          </p>
                        </div>
                        <div className="mt-6 pt-3 border-t border-border-black/20 flex items-center gap-2 font-mono text-[10px] uppercase text-ink-subtle">
                          <span className="w-2 h-2 bg-accent-electric-cyan"></span>
                          <span>Step Duration: &lt; 60 seconds</span>
                        </div>
                      </div>

                      {/* Column 02: Track */}
                      <div className="p-6 md:p-8 border-b-2 md:border-b-0 md:border-r-2 border-border-black flex flex-col justify-between hover:bg-surface-container transition-colors">
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <span className="font-headline text-4xl text-ink-primary font-black select-none leading-none">
                              02
                            </span>
                            <div className="w-9 h-9 bg-surface-container border-2 border-border-black flex items-center justify-center shadow-[2px_2px_0px_var(--shadow-color)]">
                              <Icon name="search" className="w-5 h-5 text-accent-electric-cyan" />
                            </div>
                          </div>
                          <h3 className="font-headline text-xl font-bold text-ink-primary mb-2 tracking-tight">
                            Track
                          </h3>
                          <p className="text-sm text-ink-secondary leading-relaxed">
                            Save your report ID and check progress whenever you need to.
                          </p>
                        </div>
                        <div className="mt-6 pt-3 border-t border-border-black/20 flex items-center gap-2 font-mono text-[10px] uppercase text-ink-subtle">
                          <span className="w-2 h-2 bg-accent-electric-cyan"></span>
                          <span>Real-time municipal dispatch sync</span>
                        </div>
                      </div>

                      {/* Column 03: Verify */}
                      <div className="p-6 md:p-8 flex flex-col justify-between hover:bg-surface-container transition-colors">
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <span className="font-headline text-4xl text-status-live-green font-black select-none leading-none">
                              03
                            </span>
                            <div className="w-9 h-9 bg-surface-container border-2 border-border-black flex items-center justify-center shadow-[2px_2px_0px_var(--shadow-color)]">
                              <Icon name="check" className="w-5 h-5 text-status-live-green" />
                            </div>
                          </div>
                          <h3 className="font-headline text-xl font-bold text-ink-primary mb-2 tracking-tight">
                            Verify
                          </h3>
                          <p className="text-sm text-ink-secondary leading-relaxed">
                            See the repair evidence and whether the resolution has been confirmed.
                          </p>
                        </div>
                        <div className="mt-6 pt-3 border-t border-border-black/20 flex items-center gap-2 font-mono text-[10px] uppercase text-ink-subtle">
                          <span className="w-2 h-2 bg-status-live-green"></span>
                          <span>Includes photographic proof</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* LIVE CADASTRE METRICS / GROUND TRUTH STRIP */}
                <section className="w-full bg-surface py-10 border-b-2 border-border-black">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="p-4 bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)]">
                        <div className="font-mono text-[10px] uppercase text-ink-subtle mb-1">Total Logged</div>
                        <div className="font-headline text-3xl font-black text-ink-primary mb-0.5">12,840</div>
                        <div className="font-mono text-[10px] text-ink-secondary uppercase">All Municipal Wards</div>
                      </div>
                      <div className="p-4 bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)]">
                        <div className="font-mono text-[10px] uppercase text-ink-subtle mb-1">Resolution Rate</div>
                        <div className="font-headline text-3xl font-black text-accent-electric-cyan mb-0.5">89.4%</div>
                        <div className="font-mono text-[10px] text-ink-secondary uppercase">Verified By Citizens</div>
                      </div>
                      <div className="p-4 bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)]">
                        <div className="font-mono text-[10px] uppercase text-ink-subtle mb-1">Avg Dispatch Turn</div>
                        <div className="font-headline text-3xl font-black text-ink-primary mb-0.5">18.2h</div>
                        <div className="font-mono text-[10px] text-ink-secondary uppercase">From Log to Crew</div>
                      </div>
                      <div className="p-4 bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)]">
                        <div className="font-mono text-[10px] uppercase text-ink-subtle mb-1">Open Telemetry</div>
                        <div className="font-headline text-3xl font-black text-status-live-green mb-0.5">100%</div>
                        <div className="font-mono text-[10px] text-ink-secondary uppercase">Public Audit Access</div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* INTERACTIVE BEFORE/AFTER SHOWCASE */}
                <section className="w-full bg-canvas-paper py-12 md:py-16 border-b-2 border-border-black">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="bg-surface-clean border-2 border-border-black p-6 sm:p-8 shadow-[6px_6px_0px_var(--shadow-color)]">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <div>
                          <div className="font-mono text-xs text-accent-electric-cyan uppercase tracking-wider mb-1 font-bold">
                            // VERIFIED RESOLUTION EVIDENCE
                          </div>
                          <h2 className="font-headline text-2xl font-black text-ink-primary tracking-tight">
                            Interactive Before & After Verification Slider
                          </h2>
                          <p className="text-sm text-ink-secondary mt-1">
                            Drag the slider to compare original incident reports with confirmed municipal repairs.
                          </p>
                        </div>
                        <div className="inline-flex items-center gap-2 bg-surface-container border border-border-black px-3 py-1 font-mono text-xs font-bold text-accent-electric-cyan self-start md:self-auto">
                          <span className="w-2 h-2 rounded-full bg-status-live-green shadow-[0_0_6px_#10B981]"></span>
                          <span>TWO-PARTY VERIFIED</span>
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

                {/* QUICK ACTION & BOTTOM DISPATCH BANNER */}
                <section className="w-full bg-surface py-12">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="bg-surface-clean border-2 border-accent-electric-cyan p-6 sm:p-8 shadow-[6px_6px_0px_var(--shadow-color)] flex flex-col md:flex-row items-center justify-between gap-6">
                      <div className="flex flex-col max-w-xl text-left">
                        <div className="inline-flex items-center gap-2 font-mono text-xs uppercase font-bold text-accent-electric-cyan mb-1">
                          <span className="w-2.5 h-2.5 bg-accent-electric-cyan"></span>
                          <span>IMMEDIATE MUNICIPAL RESPONSE</span>
                        </div>
                        <h2 className="font-headline text-xl sm:text-2xl font-black text-ink-primary tracking-tight mb-2">
                          Spot a hazard right now? No app download required.
                        </h2>
                        <p className="text-sm text-ink-secondary font-medium">
                          Open camera, pin your coordinates, and UrbanFix routes directly to the assigned zone authority.
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto shrink-0">
                        <div className="flex items-center justify-center gap-2 bg-surface-container border-2 border-border-black px-4 py-2.5 font-mono text-sm font-bold text-ink-primary shadow-[2px_2px_0px_var(--shadow-color)]">
                          <span className="material-symbols-outlined text-lg text-error">emergency</span>
                          <span>Hotline: 16104</span>
                        </div>
                        <button 
                          onClick={() => { setReportStep(1); setActiveTab('report'); }} 
                          className="flex items-center justify-center gap-2 bg-primary-container text-on-primary-container hover:bg-accent-electric-cyan border-2 border-border-black px-6 py-2.5 font-mono text-sm uppercase font-black shadow-[4px_4px_0px_var(--shadow-color)] hover:shadow-[2px_2px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all cursor-pointer"
                        >
                          <span>Report Issue Now</span>
                          <Icon name="arrow-right" className="w-4 h-4 text-on-primary-container" />
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
                <div className="mb-8 border-b-2 border-border-black/30 pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-xl sm:text-2xl font-extrabold text-ink-primary tracking-tight">Report a Civic Problem</h1>
                    <p className="text-sm text-ink-secondary mt-1">Add a photo, location, and a short description.</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    {[
                      { step: 1, label: 'Photo' },
                      { step: 2, label: 'Details' },
                      { step: 3, label: 'Done' }
                    ].map((s, idx) => (
                      <React.Fragment key={s.step}>
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all ${
                          reportStep === s.step 
                            ? 'bg-primary-container/20 border-border-black text-accent-electric-cyan font-bold'
                            : reportStep > s.step 
                            ? 'bg-status-live-green/10 border-status-live-green text-status-live-green font-semibold' 
                            : 'bg-surface-container border-border-black text-ink-subtle'
                        }`}>
                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-surface font-mono">
                            {reportStep > s.step ? '✓' : s.step}
                          </span>
                          <span className="hidden sm:inline">{s.label}</span>
                        </div>
                        {idx < 2 && <span className="text-slate-700 text-xs">→</span>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* STEP 1: PHOTO EVIDENCE INTAKE */}
                {reportStep === 1 && (
                  <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-5 sm:p-8 text-center reveal-up">
                    <div className="border-2 border-dashed border-border-black hover:border-border-black rounded-lg p-8 sm:p-12 transition-colors flex flex-col items-center justify-center space-y-5">
                      <Icon name="camera" className="w-10 h-10 text-accent-electric-cyan" />
                      <div className="max-w-md">
                        <h3 className="text-xl font-bold text-ink-primary tracking-tight">Add a photo of the problem</h3>
                        <p className="text-sm text-ink-secondary mt-2 leading-relaxed">
                          A clear photo helps the responsible team understand what needs fixing.
                        </p>
                      </div>
                      
                      <div className="flex flex-col items-center gap-3 w-full sm:w-auto">
                        <label className="cursor-pointer w-full sm:w-auto px-8 py-3.5 rounded-lg bg-primary-container text-on-primary-container font-mono font-bold uppercase border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all flex items-center justify-center gap-2">
                          <Icon name="upload-cloud" className="w-4 h-4 text-on-primary-container" />
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
                          className="text-xs text-ink-secondary hover:text-accent-electric-cyan underline underline-offset-4 transition-colors"
                        >
                          I cannot add a photo
                        </button>
                      </div>

                      <div className="text-xs text-ink-subtle pt-2">
                        JPEG, PNG or WebP · Up to 4 MB
                      </div>
                    </div>

                  </div>
                )}

                {/* STEP 2: REPORT DETAILS */}
                {reportStep === 2 && (
                  <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6 sm:p-8 space-y-7 shadow-2xl reveal-up">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                      {/* EVIDENCE PREVIEW / SCANNER */}
                      <div>
                        <div className="flex items-center justify-between text-xs font-mono text-ink-secondary mb-2">
                          <span>Photo preview</span>
                          {uploadedImage && <span className="text-status-live-green">● Usable photo</span>}
                        </div>
                        {uploadedImage ? (
                          <div className="ai-laser-container relative w-full h-64 rounded-lg overflow-hidden border-2 border-border-black bg-surface">
                            <img src={uploadedImage} alt="Report preview" className="w-full h-full object-cover" />
                            {isAnalyzing && (
                              <>
                                <div className="ai-laser-beam"></div>
                                <div className="ai-laser-grid"></div>
                                <div className="absolute bottom-3 inset-x-3 z-30 bg-surface backdrop-blur-md border border-border-black rounded-lg p-2.5 text-center shadow-lg">
                                  <div className="text-xs font-bold text-accent-electric-cyan flex items-center justify-center gap-2">
                                    <Icon name="scan" className="w-4 h-4 text-accent-electric-cyan animate-spin" />
                                    Checking photo…
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-64 rounded-lg border-2 border-dashed border-border-black flex flex-col items-center justify-center text-xs text-ink-subtle bg-surface-container p-6 text-center">
                            <Icon name="image-off" className="w-8 h-8 text-ink-subtle mb-2" />
                            <span>No photo supplied</span>
                            <span className="text-[10px] text-ink-subtle mt-1">Incident will be logged for authority inspection</span>
                          </div>
                        )}
                      </div>

                      {/* AI ASSESSMENT SIGNALS */}
                      <div className="flex flex-col justify-between space-y-4">
                        {isAnalyzing ? (
                          <div className="h-64 flex flex-col items-center justify-center space-y-4 py-8 bg-surface-container border-2 border-border-black rounded-lg border border-border-black">
                            <Icon name="scan" className="w-8 h-8 text-accent-electric-cyan animate-spin" />
                            <div className="text-center px-4">
                              <div className="text-sm font-bold text-ink-primary">Checking your photo</div>
                              <div className="text-xs text-ink-secondary mt-1">We are identifying the type of problem.</div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3.5">
                            <div className="border-b-2 border-border-black/30 pb-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-xs text-accent-electric-cyan font-semibold flex items-center gap-1.5">
                                    <Icon name="sparkles" className="w-3.5 h-3.5 text-accent-electric-cyan" />
                                    <span>Suggested description (AI-generated)</span>
                                  </div>
                                  <p className="text-[11px] text-ink-secondary mt-0.5">
                                    Draft suggestion based on your photo. You can edit or write your own below.
                                  </p>
                                </div>
                                {aiAnalysis?.summary ? (
                                  <button
                                    type="button"
                                    onClick={() => setReportForm(form => ({ ...form, description: aiAnalysis.summary }))}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-container/20 text-accent-electric-cyan hover:bg-primary-container/30 border border-border-black transition-colors flex items-center gap-1.5"
                                  >
                                    <Icon name="sparkles" className="w-3.5 h-3.5 text-accent-electric-cyan" />
                                    <span>Use this suggestion</span>
                                  </button>
                                ) : null}
                              </div>
                              <p className="text-xs sm:text-sm font-medium text-ink-primary mt-2.5 leading-snug bg-surface-container p-3 rounded-lg border-2 border-border-black">
                                {aiAnalysis?.summary || 'Your photo is ready. Add the location and a short description below.'}
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-xs text-ink-secondary block">Issue type</span>
                                <span className="text-ink-primary font-bold truncate block mt-0.5">{aiAnalysis?.category || reportForm.category}</span>
                              </div>
                              <div>
                                <span className="text-xs text-ink-secondary block">Urgency</span>
                                <span className={`font-bold block mt-0.5 ${
                                  (aiAnalysis?.severity || reportForm.severity) === 'Critical' ? 'text-red-400' : 'text-status-warning-amber'
                                }`}>
                                  {aiAnalysis?.severity || reportForm.severity}
                                </span>
                              </div>
                            </div>

                            {aiAnalysis?.is_civic_issue === false && (
                              <div className="rounded-lg border border-status-warning-amber bg-status-warning-amber/10 p-3 text-xs text-status-warning-amber flex items-center gap-2">
                                <Icon name="alert-triangle" className="w-4 h-4 text-status-warning-amber shrink-0" />
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
                      <div className="border-t-2 border-border-black/30 pt-6 space-y-5">
                        {/* PHOTO LOCATION DETECTED BANNER */}
                        {photoLocation && (aiAnalysis?.is_civic_issue !== false || aiAnalysis?.confidence < 0.75) && (
                          <div className="rounded-lg border border-status-live-green bg-status-live-green/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
                            <div>
                              <div className="text-xs font-bold text-status-live-green flex items-center gap-1.5 font-mono">
                                <Icon name="map-pin" className="w-4 h-4 text-status-live-green" />
                                Location found in photo
                              </div>
                              <div className="text-[11px] text-ink-secondary mt-1 font-mono">
                                {photoLocation.latitude.toFixed(5)}, {photoLocation.longitude.toFixed(5)}
                                {photoLocation.captured_at ? ` · Captured ${new Date(photoLocation.captured_at).toLocaleTimeString()}` : ''}
                              </div>
                            </div>
                            <button 
                              type="button" 
                              onClick={usePhotoLocation} 
                              className="shrink-0 px-4 py-2 rounded-lg bg-status-live-green hover:opacity-90 text-on-primary-container text-xs font-mono font-bold border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] transition-all"
                            >
                              Use this location
                            </button>
                          </div>
                        )}

                        {/* LOCATION PICKER & ADDRESS INPUT */}
                        <div>
                          <label className="block text-xs font-mono text-ink-secondary mb-1.5 font-semibold">
                            Where is the problem? <span className="text-accent-electric-cyan">*</span>
                          </label>
                          <div className="flex items-center gap-2 glass-input rounded-lg px-3.5 py-2.5 text-sm">
                            <Icon name="map-pin" className="w-4 h-4 text-accent-electric-cyan shrink-0" />
                            <input 
                              type="text" 
                              value={reportForm.location}
                              placeholder="Enter street, area or landmark"
                              onChange={(e) => setReportForm({...reportForm, location: e.target.value, locationSource: reportForm.latitude == null ? 'manual' : reportForm.locationSource, locationConfirmed: true})}
                              className="bg-transparent text-ink-primary focus:outline-none w-full text-xs sm:text-sm"
                            />
                            <button 
                              type="button" 
                              onClick={captureLocation} 
                              className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all ${
                                reportForm.locationSource === 'device_gps' ? 'bg-status-live-green text-status-live-green border border-status-live-green' : 'bg-surface-container text-accent-electric-cyan border border-border-black hover:bg-primary-container/25'
                              }`}
                            >
                              {reportForm.locationSource === 'device_gps' ? '✓ Location added' : 'Use my location'}
                            </button>
                          </div>

                          <div className="flex items-center justify-between mt-2">
                            <button 
                              type="button" 
                              onClick={() => setShowLocationMap(value => !value)} 
                              className="text-xs text-accent-electric-cyan hover:text-accent-electric-cyan font-semibold flex items-center gap-1 transition-colors"
                            >
                              <Icon name={showLocationMap ? 'chevron-up' : 'map'} className="w-3.5 h-3.5" />
                              {showLocationMap ? 'Hide map' : 'Choose on map'}
                            </button>
                            {reportForm.locationSource && (
                              <span className="text-[10px] font-mono text-status-live-green">
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
                          <label className="block text-xs font-mono text-ink-secondary mb-1.5 font-semibold">
                            Phone or email <span className="font-normal">(optional)</span>
                          </label>
                          <input 
                            type="text" 
                            value={reportForm.reporterContact} 
                            onChange={e => setReportForm({...reportForm, reporterContact: e.target.value})} 
                            placeholder="For updates about this report"
                            className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm focus:outline-none" 
                          />
                        </div>

                        {/* DESCRIPTION */}
                        <div>
                          <label className="block text-xs font-mono text-ink-secondary mb-1.5 font-semibold">
                            What happened? <span className="text-accent-electric-cyan">*</span>
                          </label>
                          <textarea 
                            rows={3}
                            value={reportForm.description}
                            onChange={(e) => setReportForm({...reportForm, description: e.target.value})}
                            placeholder="Briefly describe the problem"
                            className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm focus:outline-none"
                          />
                        </div>

                        {/* ACTION BUTTONS */}
                        <div className="flex items-center justify-between pt-3">
                          <button 
                            onClick={() => setReportStep(1)} 
                            className="px-5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-ink-secondary hover:text-ink-primary transition-colors"
                          >
                            ← Change photo
                          </button>
                          <button 
                            onClick={handleFinalSubmit}
                            disabled={isSubmitting || (aiAnalysis?.is_civic_issue === false && aiAnalysis?.confidence >= 0.75)}
                            className="px-7 py-3.5 rounded-lg text-sm font-bold bg-primary-container text-on-primary-container font-mono font-bold uppercase border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50 flex items-center gap-2"
                          >
                            {isSubmitting ? (
                              <>
                                <Icon name="refresh-cw" className="w-4 h-4 animate-spin text-on-primary-container" />
                                <span>Submitting…</span>
                              </>
                            ) : (
                              <>
                                <span>Submit report</span>
                                <Icon name="arrow-right" className="w-4 h-4 text-on-primary-container" />
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
                <section aria-labelledby="report-success-title" className="bg-surface-clean border-2 border-status-live-green shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6 sm:p-8 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-status-live-green/10 text-status-live-green">
                    <Icon name="check" className="h-6 w-6" />
                  </div>
                  <h1 id="report-success-title" className="mt-5 text-2xl font-bold text-ink-primary">Report submitted</h1>
                  <p className="mt-2 text-sm text-ink-secondary">Save this report ID. You can use it to check progress anytime.</p>
                  <div className="mt-6 rounded-lg border-2 border-border-black bg-surface px-4 py-5">
                    <div className="text-xs text-ink-secondary">Your report ID</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-accent-electric-cyan">{submittedReportId}</div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button onClick={() => { navigator.clipboard?.writeText(submittedReportId); showToast('Report ID copied.'); }} className="min-h-12 rounded-lg border-2 border-border-black px-5 text-sm font-semibold text-ink-primary hover:border-border-black">Copy report ID</button>
                    <button onClick={() => setSubmittedReportId('')} className="min-h-12 rounded-lg bg-primary-container text-on-primary-container font-mono font-bold uppercase border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all px-5">Track this report</button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'track' && !submittedReportId && !selectedReport && (
              <div className="max-w-xl mx-auto px-4 py-16">
                <div className="rounded-lg bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] p-6 sm:p-8 space-y-4 reveal-up">
                  <h1 className="text-2xl font-bold text-ink-primary tracking-tight">Track a Report</h1>
                  <p className="text-sm text-ink-secondary max-w-sm leading-relaxed">
                    Enter your report ID to see its current status and latest update.
                  </p>
                  <label htmlFor="tracking-id" className="block text-sm font-semibold text-ink-primary">Report ID</label>
                  <div className="flex flex-col sm:flex-row gap-2.5 mt-2">
                    <input 
                      id="tracking-id"
                      value={trackingQuery} 
                      onChange={e => setTrackingQuery(e.target.value)} 
                      onKeyDown={e => e.key === 'Enter' && trackById()} 
                      placeholder="CP-ABC123 or ABC123"
                      className="flex-1 glass-input rounded-lg px-4 py-3 text-ink-primary font-mono text-sm focus:outline-none"
                    />
                    <button 
                      onClick={trackById} 
                      disabled={trackingBusy}
                      className="px-6 py-3 rounded-lg bg-primary-container text-on-primary-container font-mono font-bold uppercase border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                    >
                      {trackingBusy ? 'Finding…' : 'Track'}
                    </button>
                  </div>
                  {trackingError && <div role="alert" className="text-xs text-red-300 rounded-lg border border-red-500 bg-transparent p-3">{trackingError}</div>}
                  <button onClick={openJudgeDemo} className="text-sm font-semibold text-accent-electric-cyan hover:text-sky-200 inline-flex items-center gap-1.5">
                    See public report
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'track' && !submittedReportId && selectedReport && (
              <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 space-y-8 reveal-up">
                {/* INCIDENT HEADER CARD */}
                <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6 sm:p-7 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-2xl">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-2xl font-bold font-mono text-accent-electric-cyan">
                        {selectedReport.id}
                      </span>
                      <span className={`px-3 py-1 rounded-lg text-xs font-mono font-bold border-2 ${
                        selectedReport.status === 'Resolved' 
                          ? 'bg-status-live-green/10 text-status-live-green border-status-live-green' 
                          : 'bg-status-warning-amber text-status-warning-amber border-status-warning-amber'
                      }`}>
                        {selectedReport.status}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono border ${
                        selectedReport.severity === 'Critical' ? 'bg-transparent text-red-400 border-red-500' : 'bg-canvas-paper text-ink-secondary border-border-black'
                      }`}>
                        {selectedReport.severity}
                      </span>
                    </div>

                    <h1 className="text-xl font-bold text-ink-primary mt-2 tracking-tight break-words">{selectedReport.title}</h1>
                    <p className="text-xs text-ink-secondary flex items-center gap-1.5 mt-1 font-sans">
                      <Icon name="map-pin" className="w-3.5 h-3.5 text-accent-electric-cyan shrink-0" />
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
                        className="glass-input rounded-lg px-3.5 py-2 text-xs font-mono text-ink-primary focus:outline-none w-36" 
                      />
                      <button 
                        onClick={trackById} 
                        className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-mono font-bold uppercase border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all"
                      >
                        Track
                      </button>
                    </div>
                    <select 
                      value={selectedReport.id}
                      onChange={(e) => setSelectedReport(reports.find(r => r.id === e.target.value))}
                      className="glass-input rounded-lg px-3 py-2 text-xs font-mono text-ink-primary focus:outline-none cursor-pointer"
                    >
                      {reports.map(r => (
                        <option key={r.id} value={r.id} className="bg-surface-container text-ink-primary">{r.id} · {r.category}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2-COLUMN TIMELINE & EVIDENCE VERIFICATION WORKSPACE */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                  {/* TIMELINE COLUMN */}
                  <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6 sm:p-7 space-y-6 shadow-xl">
                    <div className="flex items-center justify-between border-b-2 border-border-black/30 pb-3">
                      <h2 className="text-xs font-bold text-accent-electric-cyan uppercase tracking-widest font-mono flex items-center gap-2">
                        <Icon name="clock" className="w-4 h-4 text-accent-electric-cyan" />
                        Report progress
                      </h2>
                    </div>
                    
                    <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2.5 before:bottom-2.5 before:w-0.5 before:bg-canvas-paper">
                      {selectedReport.timeline.map((item, idx) => (
                        <div key={idx} className="relative">
                          <div className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full border-2 transition-all ${
                            item.done ? 'bg-primary-container border-border-black' : 'bg-surface border-border-black'
                          }`} />
                          <div className="text-xs font-bold text-ink-primary">{item.step}</div>
                          <div className="text-[11px] font-mono text-ink-secondary mt-0.5">{item.time}</div>
                          {item.note && <div className="text-[10px] text-ink-subtle mt-1 leading-snug">{item.note}</div>}
                        </div>
                      ))}
                    </div>

                    <div className="border-t-2 border-border-black/30 pt-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-ink-secondary">
                        <span>Responsible Public Authority</span>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-warning-amber/10 text-status-warning-amber border border-status-warning-amber">
                            {selectedReport.assigned_authority?.authority_data_status === 'gazette_verified' ? 'Gazette Verified' : 'Candidate Authority'}
                          </span>
                          {selectedReport.assigned_authority?.jurisdiction_data_status === 'statutory_polygon_verified' ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-live-green/10 text-status-live-green border border-status-live-green">
                              Statutory Verified
                            </span>
                          ) : selectedReport.assigned_authority?.jurisdiction_data_status === 'heuristic_bbox' ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-warning-amber/10 text-status-warning-amber border border-status-warning-amber">
                              Heuristic Area
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-container text-accent-electric-cyan border border-border-black">
                              Location Inferred
                            </span>
                          )}
                          {selectedReport.assigned_authority?.assignment_status === 'officer_assigned' && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-container border-2 border-border-black text-ink-secondary">
                              Officer Assigned
                            </span>
                          )}
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-canvas-paper text-ink-secondary border-2 border-border-black">
                            Simulated Workflow
                          </span>
                        </div>
                      </div>
                      <div className="bg-surface-container border-2 border-border-black p-3 rounded-lg text-xs text-ink-primary space-y-2 border-2 border-border-black">
                        <div className="flex items-center gap-2 font-semibold">
                          <Icon name="building-2" className="w-4 h-4 text-accent-electric-cyan shrink-0" />
                          <span>
                            {selectedReport.assigned_authority?.authority_name
                              ? `${selectedReport.assigned_authority.authority_name} (${selectedReport.assigned_authority.short_code})`
                              : (selectedReport.needs_review || selectedReport.department === 'Needs Review' ? 'Awaiting Authority Review' : selectedReport.department)}
                          </span>
                        </div>
                        {selectedReport.assigned_authority?.department && selectedReport.assigned_authority?.authority_name && (
                          <div className="text-[11px] text-ink-secondary pl-6">
                            Department: <span className="text-ink-primary font-medium">{selectedReport.assigned_authority.department}</span>
                          </div>
                        )}
                        {selectedReport.assigned_authority?.jurisdiction && (
                          <div className="text-[11px] text-ink-secondary pl-6 flex items-center gap-1.5">
                            <Icon name="map-pin" className="w-3 h-3 text-accent-electric-cyan shrink-0" />
                            <span>{selectedReport.assigned_authority.jurisdiction}</span>
                          </div>
                        )}
                        {selectedReport.assigned_authority?.assignment_reason && (
                          <div className="text-[10px] text-ink-subtle pl-6 border-t-2 border-border-black/30/60 pt-1.5 leading-snug">
                            {selectedReport.assigned_authority.assignment_reason}
                          </div>
                        )}
                      </div>
                      {selectedReport.priority_score != null && (
                        <details className="rounded-lg border-2 border-border-black p-3">
                          <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">Why this priority?</summary>
                          <div className="flex items-center justify-between text-xs">
                            <span className="mt-2 font-bold text-ink-primary">Priority</span>
                            <span className="font-mono font-extrabold text-accent-electric-cyan">{selectedReport.priority_score}/100</span>
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">Based on urgency, how many people reported it, how long it has waited, and location safety.</p>
                        </details>
                      )}
                    </div>
                  </div>

                  {/* EVIDENCE & VERIFICATION COLUMN */}
                  <div className="lg:col-span-2 bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6 sm:p-7 space-y-6 shadow-xl">
                    <div className="flex items-center justify-between border-b-2 border-border-black/30 pb-3">
                      <h2 className="text-xs font-bold text-accent-electric-cyan uppercase tracking-widest font-mono flex items-center gap-2">
                        <Icon name="shield-check" className="w-4 h-4 text-accent-electric-cyan" />
                        RESOLUTION & EVIDENCE
                      </h2>
                      {selectedReport.status === 'Resolved' || selectedReport.citizen_verification?.fixed ? (
                        <span className="text-xs text-status-live-green font-mono bg-status-live-green/10 px-2.5 py-1 rounded-full border border-status-live-green font-bold flex items-center gap-1">
                          <span>✓</span> Citizen Confirmed & Resolved
                        </span>
                      ) : selectedReport.afterImage || selectedReport.resolution_evidence ? (
                        <span className="text-xs text-status-warning-amber font-mono bg-status-warning-amber/10 px-2.5 py-1 rounded-full border border-status-warning-amber font-bold flex items-center gap-1">
                          <span>⏳</span> Awaiting Citizen Verification
                        </span>
                      ) : null}
                    </div>

                    {/* RESOLUTION VERIFICATION */}
                    <div>
                      <div className="text-[11px] font-mono text-ink-secondary mb-2 font-semibold">RESOLUTION VERIFICATION</div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className={`p-3 rounded-lg border flex flex-col items-center justify-center gap-1.5 transition-all text-center ${
                          selectedReport.officer_evidence_submitted || selectedReport.resolution_evidence
                            ? 'bg-status-live-green/10 border-status-live-green text-status-live-green'
                            : 'bg-surface-container border-border-black text-ink-secondary'
                        }`}>
                          <Icon name="landmark" className={`w-4 h-4 ${selectedReport.officer_evidence_submitted || selectedReport.resolution_evidence ? 'text-status-live-green' : 'text-ink-subtle'}`} />
                          <span className="text-[11px] font-bold tracking-tight">Field Officer Evidence</span>
                          <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${selectedReport.officer_evidence_submitted || selectedReport.resolution_evidence ? 'bg-status-live-green/10 text-status-live-green font-bold' : 'text-ink-subtle bg-surface-container'}`}>
                            {selectedReport.officer_evidence_submitted || selectedReport.resolution_evidence ? '✓ SUBMITTED' : 'PENDING'}
                          </span>
                        </div>
                        <div className={`p-3 rounded-lg border flex flex-col items-center justify-center gap-1.5 transition-all text-center ${
                          selectedReport.citizen_verification?.fixed || selectedReport.resolution_approvals?.reporter
                            ? 'bg-status-live-green/10 border-status-live-green text-status-live-green'
                            : 'bg-surface-container border-border-black text-ink-secondary'
                        }`}>
                          <Icon name="check" className={`w-4 h-4 ${selectedReport.citizen_verification?.fixed || selectedReport.resolution_approvals?.reporter ? 'text-status-live-green' : 'text-ink-subtle'}`} />
                          <span className="text-[11px] font-bold tracking-tight">Citizen Verification</span>
                          <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${selectedReport.citizen_verification?.fixed || selectedReport.resolution_approvals?.reporter ? 'bg-status-live-green/10 text-status-live-green font-bold' : 'text-ink-subtle bg-surface-container'}`}>
                            {selectedReport.citizen_verification?.fixed || selectedReport.resolution_approvals?.reporter ? '✓ VERIFIED' : 'PENDING'}
                          </span>
                        </div>
                      </div>
                    </div>


                    {/* CONTRACTOR STAR RATING */}
                    {selectedReport.afterImage && selectedReport.assigned_contractor_id && (authUser?.role === 'admin' || sessionStorage.getItem(`urbanfix-reporter-${selectedReport.id}`)) && (
                      <div className="rounded-lg border-2 border-border-black bg-surface-container p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-ink-primary flex items-center gap-1.5">
                            <Icon name="star" className="w-3.5 h-3.5 text-status-warning-amber" />
                            Rate Contractor Performance
                          </div>
                          <p className="text-[11px] text-ink-secondary mt-0.5">Rate quality, speed, and clean-up execution</p>
                        </div>
                        <div className="flex gap-1.5">
                          {[1, 2, 3, 4, 5].map(score => (
                            <button 
                              key={score} 
                              onClick={() => rateContractor(selectedReport, score)} 
                              className="text-2xl text-status-warning-amber hover:scale-125 transition-transform" 
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
                      <div data-testid="citizen-verification-card" className="rounded-lg border-2 border-border-black bg-surface p-5 space-y-4 shadow-lg">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-border-black/30 pb-3">
                          <div className="flex items-center gap-2">
                            <Icon name="shield-check" className="w-4 h-4 text-accent-electric-cyan" />
                            <span className="text-xs font-bold font-mono text-ink-primary tracking-wider uppercase">Citizen Verification Gate</span>
                          </div>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-canvas-paper text-ink-secondary border-2 border-border-black">
                            Simulated Authority Workflow
                          </span>
                        </div>

                        {/* If already confirmed & resolved */}
                        {(selectedReport.status === 'Resolved' || selectedReport.citizen_verification?.fixed) ? (
                          <div className="rounded-lg border border-status-live-green bg-status-live-green/10 p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold font-mono text-status-live-green flex items-center gap-1.5">
                                <Icon name="circle-check" className="w-4 h-4" />
                                RESOLUTION CONFIRMED BY CITIZEN
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-live-green/10 text-status-live-green font-bold">
                                Status: Resolved
                              </span>
                            </div>
                            <p className="text-xs text-ink-secondary leading-relaxed">
                              The reporter confirmed this incident was successfully fixed on site.
                            </p>
                            {selectedReport.citizen_verification?.note && (
                              <div className="text-xs text-ink-secondary bg-surface-container p-2.5 rounded-lg border-2 border-border-black italic">
                                "{selectedReport.citizen_verification.note}"
                              </div>
                            )}
                          </div>
                        ) : selectedReport.status === 'Reopened - Needs Review' ? (
                          <div className="rounded-lg border border-status-warning-amber bg-status-warning-amber/10 p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold font-mono text-status-warning-amber flex items-center gap-1.5">
                                <Icon name="alert-triangle" className="w-4 h-4" />
                                RESOLUTION DISPUTED · REOPENED
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-warning-amber/10 text-status-warning-amber font-bold">
                                Reopened - Needs Review
                              </span>
                            </div>
                            <p className="text-xs text-ink-secondary leading-relaxed">
                              The citizen reported that the problem was not satisfactorily fixed. Authority field crew has been notified to re-inspect.
                            </p>
                            {selectedReport.citizen_verification?.note && (
                              <div className="text-xs text-status-warning-amber bg-surface-container p-2.5 rounded-lg border-2 border-border-black italic">
                                Dispute reason: "{selectedReport.citizen_verification.note}"
                              </div>
                            )}
                          </div>
                        ) : (
                          /* Pending verification form */
                          <div className="space-y-3.5">
                            {(selectedReport.completion_notes || selectedReport.resolution_evidence?.completion_note) && (
                              <div className="rounded-lg bg-surface-container border-2 border-border-black p-3 text-xs">
                                <div className="text-[10px] font-mono text-accent-electric-cyan font-bold mb-1">FIELD OFFICER COMPLETION NOTE</div>
                                <p className="text-ink-primary leading-relaxed">
                                  {selectedReport.completion_notes || selectedReport.resolution_evidence?.completion_note}
                                </p>
                              </div>
                            )}

                            <div>
                              <div className="flex items-center justify-between text-[11px] font-mono text-ink-secondary mb-1">
                                <span>REPORTER VERIFICATION TOKEN</span>
                                {sessionStorage.getItem(`urbanfix-reporter-${selectedReport.id}`) && (
                                  <span className="text-[10px] text-status-live-green font-bold">✓ Active on this device</span>
                                )}
                              </div>
                              <input
                                type="text"
                                placeholder="Paste or verify reporter token..."
                                value={verificationToken || (selectedReport ? sessionStorage.getItem(`urbanfix-reporter-${selectedReport.id}`) || '' : '')}
                                onChange={(e) => setVerificationToken(e.target.value)}
                                className="w-full glass-input rounded-lg p-2.5 text-xs text-ink-primary font-mono"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-mono text-ink-secondary mb-1">
                                FEEDBACK / NOTES (Required if rejecting or reporting partial fix)
                              </label>
                              <textarea
                                rows={2}
                                placeholder="Enter inspection feedback or reason for dispute..."
                                value={citizenFeedback}
                                onChange={(e) => setCitizenFeedback(e.target.value)}
                                className="w-full glass-input rounded-lg p-2 text-xs text-ink-primary resize-none"
                              />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                              <button
                                disabled={isVerifying}
                                onClick={() => handleCitizenVerify('fixed')}
                                className="py-2.5 px-3 rounded-lg bg-status-live-green hover:opacity-90 disabled:opacity-40 text-on-primary-container text-xs font-mono font-bold border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] transition-all flex items-center justify-center gap-1.5"
                              >
                                <Icon name="check" className="w-4 h-4" />
                                <span>Confirm Fixed</span>
                              </button>
                              <button
                                disabled={isVerifying}
                                onClick={() => handleCitizenVerify('partially_fixed')}
                                className="py-2.5 px-3 rounded-lg bg-status-warning-amber/10 border-2 border-status-warning-amber text-status-warning-amber hover:bg-status-warning-amber/20 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                              >
                                <span>Partially Fixed</span>
                              </button>
                              <button
                                disabled={isVerifying}
                                onClick={() => handleCitizenVerify('not_fixed')}
                                className="py-2.5 px-3 rounded-lg bg-transparent border border-red-500 text-red-400 hover:bg-transparent text-xs font-bold transition-all flex items-center justify-center gap-1.5"
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
                      <a href={selectedReport.resolution_evidence.report_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-lg border-2 border-border-black bg-surface-container px-4 py-3 text-sm font-semibold text-accent-electric-cyan hover:border-border-black">
                        <span className="flex items-center gap-2"><Icon name="file-text" className="w-4 h-4" />View contractor work report</span>
                        <Icon name="external-link" className="w-4 h-4" />
                      </a>
                    )}

                    <div className="space-y-3">
                      <div>
                        <div className="text-[10px] font-mono font-bold text-ink-secondary uppercase tracking-wider mb-1">Citizen Description</div>
                        <p className="text-xs sm:text-sm text-ink-primary leading-relaxed font-sans bg-surface-container border-2 border-border-black p-4 rounded-lg">
                          {selectedReport.description || 'No written description was provided.'}
                        </p>
                      </div>
                      {selectedReport.summary && selectedReport.summary !== selectedReport.description && (
                        <div>
                          <div className="text-[10px] font-mono font-bold text-accent-electric-cyan uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <Icon name="sparkles" className="w-3 h-3 text-accent-electric-cyan" />
                            <span>AI Assessment Summary (AI-generated)</span>
                          </div>
                          <p className="text-xs text-ink-secondary leading-relaxed font-sans bg-surface-container p-3.5 rounded-lg border-2 border-border-black">
                            {selectedReport.summary}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-border-black/30 pt-4">
                      <div className="text-xs text-ink-secondary">
                        <span className="text-ink-primary font-bold">{selectedReport.affected_count || 1}</span> citizens affected · <span className="text-ink-primary font-bold">{selectedReport.duplicates || 1}</span> linked incident reports
                      </div>
                      <button 
                        onClick={markAffected} 
                        className="px-4 py-2 rounded-lg bg-surface-container hover:bg-primary-container/20 border border-border-black text-accent-electric-cyan text-xs font-bold transition-all flex items-center gap-1.5"
                      >
                        <Icon name="thumbs-up" className="w-3.5 h-3.5 text-accent-electric-cyan" />
                        <span>I’m Affected Too (+1)</span>
                      </button>
                    </div>

                    <button 
                      onClick={() => loadAccountabilityReceipt(selectedReport)} 
                      className="w-full py-3 rounded-lg bg-surface-container border-2 border-border-black hover:border-border-black text-xs font-semibold text-accent-electric-cyan transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Icon name="file-text" className="w-4 h-4 text-accent-electric-cyan" />
                      <span>View accountability receipt</span>
                    </button>
                  </div>
                </div>

                {/* ACCOUNTABILITY RECEIPT DISPLAY */}
                {accountabilityReceipt && accountabilityReceipt.complaint_id === selectedReport.id && (
                  <section aria-label="Public accountability receipt" className="rounded-lg bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] p-6 sm:p-8 space-y-5 shadow-2xl reveal-up">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-border-black/30 pb-4">
                      <div>
                        <div className="text-[10px] font-mono text-accent-electric-cyan font-bold tracking-widest uppercase">ACCOUNTABILITY RECEIPT</div>
                        <h2 className="text-xl font-extrabold text-ink-primary mt-1">{accountabilityReceipt.incident_id || accountabilityReceipt.complaint_id}</h2>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-lg bg-surface-container border-2 border-border-black p-4 rounded-lg">
                        <div className="text-ink-secondary font-mono text-[10px]">AI CLASSIFICATION</div>
                        <div className="text-ink-primary font-bold mt-1">{accountabilityReceipt.ai_assessment.category}</div>
                        <div className="text-[11px] text-accent-electric-cyan mt-0.5">{Math.round((accountabilityReceipt.ai_assessment.confidence || 0)*100)}% Confidence</div>
                      </div>
                      <div className="rounded-lg bg-surface-container border-2 border-border-black p-4 rounded-lg">
                        <div className="text-ink-secondary font-mono text-[10px]">PRIORITY SCORE</div>
                        <div className="text-ink-primary font-bold mt-1 text-lg font-mono">{accountabilityReceipt.priority.score}/100</div>
                      </div>
                      <div className="rounded-lg bg-surface-container border-2 border-border-black p-4 rounded-lg">
                        <div className="text-ink-secondary font-mono text-[10px]">LINKED REPORTS</div>
                        <div className="text-ink-primary font-bold mt-1 text-lg font-mono">{accountabilityReceipt.incident_report_count}</div>
                      </div>
                      <div className="rounded-lg bg-surface-container border-2 border-border-black p-4 rounded-lg">
                        <div className="text-ink-secondary font-mono text-[10px]">STATUS</div>
                        <div className={`font-bold mt-1 ${accountabilityReceipt.resolution.fully_verified ? 'text-status-live-green' : 'text-status-warning-amber'}`}>
                          {accountabilityReceipt.resolution.fully_verified ? 'Verified (2/2)' : 'Awaiting Approval'}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-ink-secondary leading-relaxed font-sans">
                      {accountabilityReceipt.priority.methodology}
                    </p>
                  </section>
                )}
              </div>
            )}

            {/* 4. PUBLIC CIVIC MAP */}
            {activeTab === 'map' && (
              <div className="max-w-7xl mx-auto px-4 py-8 sm:py-10 space-y-6 reveal-up">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] p-5 sm:p-6 rounded-lg shadow-xl">
                  <div>
                    <div className="text-xs text-accent-electric-cyan font-semibold uppercase">Public reports</div>
                    <h1 className="text-xl sm:text-2xl font-bold text-ink-primary mt-1 tracking-tight">Issues near you</h1>
                    <p className="text-sm text-ink-secondary mt-1">Select a marker to see the problem and its current status.</p>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {['All', 'Roads', 'Sanitation', 'Water'].map((f) => {
                      const count = reports.filter(rep => f === 'All' || (f === 'Roads' && /road/i.test(rep.category)) || (f === 'Sanitation' && /waste|sanitation/i.test(rep.category)) || (f === 'Water' && /water|drain|sewer/i.test(rep.category))).length;
                      return (
                        <button 
                          onClick={() => setMapFilter(f)} 
                          key={f} 
                          className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                            mapFilter === f 
                              ? 'bg-primary-container text-on-primary-container font-mono font-bold uppercase border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)]' 
                              : 'bg-surface-container border-2 border-border-black text-ink-secondary hover:text-ink-primary border-2 border-border-black hover:border-border-black'
                          }`}
                        >
                          <span>{f}</span>
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${mapFilter === f ? 'bg-surface text-accent-electric-cyan' : 'bg-surface-container text-ink-secondary'}`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-4 sm:p-6 shadow-2xl space-y-4">
                  <AuthorityMap
                    reports={reports.filter(rep => mapFilter === 'All' || (mapFilter === 'Roads' && /road/i.test(rep.category)) || (mapFilter === 'Sanitation' && /waste|sanitation/i.test(rep.category)) || (mapFilter === 'Water' && /water|drain|sewer/i.test(rep.category)))}
                    onSelect={report => { setSelectedReport(report); setActiveTab('track'); }}
                    useClusters={reportsTruncated}
                  />
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2 text-[11px] font-mono">
                    <div className="bg-surface-container border-2 border-border-black p-2.5 rounded-lg flex items-center gap-2 text-ink-secondary">
                      <span className="w-2.5 h-2.5 rounded-full bg-status-live-green shadow-glow-emerald" /> 
                      <span>Contractor + authority verified</span>
                    </div>
                    <div className="bg-surface-container border-2 border-border-black p-2.5 rounded-lg flex items-center gap-2 text-ink-secondary">
                      <span className="w-2.5 h-2.5 rounded-full bg-primary-container shadow-glow-sky" /> 
                      <span>Partly Approved / Progress</span>
                    </div>
                    <div className="bg-surface-container border-2 border-border-black p-2.5 rounded-lg flex items-center gap-2 text-ink-secondary">
                      <span className="w-2.5 h-2.5 rounded-full bg-status-warning-amber" /> 
                      <span>Moderate Priority</span>
                    </div>
                    <div className="bg-surface-container border-2 border-border-black p-2.5 rounded-lg flex items-center gap-2 text-ink-secondary">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-glow-rose" /> 
                      <span>Critical / Urgent</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. COMMUNITY ACTION (YOUTH MICRO-MAINTENANCE) */}
            {activeTab === 'community' && (
              <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12 space-y-7 reveal-up">
                <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] p-6 sm:p-7 rounded-lg shadow-xl">
                  <div className="text-[10px] font-mono tracking-widest text-accent-electric-cyan font-bold uppercase">SUPERVISED COMMUNITY ACTION</div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-ink-primary mt-1 tracking-tight">Propose Low-Risk Micro-Maintenance</h1>
                  <p className="text-xs sm:text-sm text-ink-secondary mt-1 leading-relaxed">
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
                  <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-8 text-center space-y-4">
                    <p className="text-sm text-ink-secondary">The current active account is not registered as a youth worker.</p>
                    <button onClick={logout} className="px-5 py-2.5 rounded-lg bg-surface-container border-2 border-border-black text-xs font-semibold text-ink-primary hover:text-ink-primary">
                      Log out
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] bg-surface-container rounded-lg p-4 sm:p-5">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-ink-primary">{authUser.name}</span>
                          <span className="px-2.5 py-0.5 rounded-full bg-status-live-green/10 border border-status-live-green text-[10px] font-mono text-status-live-green font-bold">
                            VERIFIED CITIZEN
                          </span>
                        </div>
                        <div className="text-xs text-ink-secondary mt-0.5 font-mono">{authUser.email} · Proposals & proof linked to escrow balance</div>
                      </div>
                      <button onClick={logout} className="px-4 py-2 rounded-lg bg-surface-container border-2 border-border-black hover:border-border-black text-xs font-semibold text-ink-secondary">
                        Log out
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 text-center text-xs font-mono">
                      <div className="rounded-lg bg-surface-container border-2 border-border-black p-3 border-2 border-border-black">
                        <span className="text-accent-electric-cyan font-bold block text-sm">01</span> Submit Plan & Estimate
                      </div>
                      <div className="rounded-lg bg-surface-container border-2 border-border-black p-3 border-2 border-border-black">
                        <span className="text-status-warning-amber font-bold block text-sm">02</span> Authority Escrow Lock
                      </div>
                      <div className="rounded-lg bg-surface-container border-2 border-border-black p-3 border-2 border-border-black">
                        <span className="text-status-live-green font-bold block text-sm">03</span> After Photo & Payout
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      {/* PROPOSAL FORM */}
                      <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6 space-y-4 shadow-xl">
                        <h2 className="text-sm font-bold text-ink-primary font-mono uppercase tracking-wider">Submit New Proposal</h2>
                        <select 
                          value={repairForm.complaint_id} 
                          onChange={e => setRepairForm({...repairForm, complaint_id: e.target.value})} 
                          className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary"
                        >
                          <option value="" className="bg-surface-container">Select an eligible low-risk task</option>
                          {reports.filter(r => r.status !== 'Resolved' && r.volunteer_eligible === true).map(r => (
                            <option key={r.id} value={r.id} className="bg-surface-container">{r.id} · {r.category} · {r.location}</option>
                          ))}
                        </select>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <input 
                            type="number" 
                            min="1" 
                            value={repairForm.estimated_price} 
                            onChange={e => setRepairForm({...repairForm, estimated_price: e.target.value})} 
                            placeholder="Estimate (BDT)" 
                            className="min-w-0 glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary"
                          />
                          <input 
                            type="number" 
                            min="1" 
                            value={repairForm.estimated_hours} 
                            onChange={e => setRepairForm({...repairForm, estimated_hours: e.target.value})} 
                            placeholder="Hours required" 
                            className="min-w-0 glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary"
                          />
                        </div>
                        <textarea 
                          rows="4" 
                          value={repairForm.plan} 
                          onChange={e => setRepairForm({...repairForm, plan: e.target.value})} 
                          placeholder="Detail materials needed, safe tools, clean-up steps, and expected completion result..." 
                          className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary"
                        />
                        <button 
                          onClick={submitRepairRequest} 
                          disabled={!repairForm.complaint_id || repairForm.plan.length < 10 || !repairForm.estimated_price} 
                          className="w-full py-3.5 rounded-lg bg-primary-container text-on-primary-container font-mono font-bold uppercase border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-40"
                        >
                          Send Proposal to Authority
                        </button>
                      </div>

                      {/* PROPOSAL HISTORY */}
                      <div className="space-y-3.5">
                        <h2 className="text-sm font-bold text-ink-primary font-mono uppercase tracking-wider">Your Proposal Ledger</h2>
                        {repairRequests.length ? repairRequests.slice().reverse().map(req => (
                          <div key={req.request_id} className="bg-surface-container border-2 border-border-black rounded-lg p-4 sm:p-5 space-y-3">
                            <div className="flex justify-between gap-3">
                              <div>
                                <div className="font-mono text-accent-electric-cyan text-xs font-bold">{req.request_id} · {req.complaint_id}</div>
                                <div className="text-sm font-bold text-ink-primary mt-0.5">{req.issue_title || req.applicant_name}</div>
                              </div>
                              <span className="text-[10px] text-status-warning-amber font-mono font-bold bg-status-warning-amber/10 border-2 border-status-warning-amber px-2 py-0.5 rounded-full h-fit">
                                {req.status}
                              </span>
                            </div>
                            <div className="text-xs text-ink-secondary font-mono">
                              Budget: BDT {Number(req.estimated_price).toLocaleString()} · {req.estimated_hours}h
                            </div>
                            {req.admin_note && (
                              <div className="rounded-lg border-2 border-border-black bg-surface p-2.5 text-xs text-ink-secondary">
                                <span className="text-ink-subtle font-mono text-[10px] block">AUTHORITY NOTE</span> {req.admin_note}
                              </div>
                            )}
                            {req.status === 'Approved - Awaiting Work' && (
                              <label className="block cursor-pointer text-center text-xs px-4 py-2.5 rounded-lg bg-status-live-green/10 text-status-live-green border border-status-live-green hover:bg-status-live-green/20 border-2 border-status-live-green transition-colors font-bold">
                                📷 Upload Required After-Repair Photo
                                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={e => submitProofFile(req, e.target.files?.[0])} />
                              </label>
                            )}
                            {req.proof && (
                              <div className="flex gap-3 items-center bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] p-2.5 rounded-lg border-2 border-border-black">
                                <img src={absoluteMediaUrl(req.proof.after_image_url)} alt="Your after-repair proof" className="w-16 h-14 object-cover rounded-lg border-2 border-border-black" />
                                <span className="text-xs text-status-live-green font-semibold">After photo uploaded for authority release.</span>
                              </div>
                            )}
                          </div>
                        )) : (
                          <div className="bg-surface-container border-2 border-border-black rounded-lg p-8 text-center text-xs text-ink-secondary">
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
                  <div className="flex bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-1">
                    <button onClick={() => setAuthMode('login')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${authMode === 'login' ? 'bg-primary-container text-on-primary-container' : 'text-ink-secondary'}`}>Login</button>
                    <button onClick={() => setAuthMode('register')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${authMode === 'register' ? 'bg-primary-container text-on-primary-container' : 'text-ink-secondary'}`}>Register</button>
                  </div>
                  <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6 sm:p-7 space-y-4 shadow-2xl">
                    <h1 className="text-xl font-extrabold text-ink-primary">Contractor Service Hub</h1>
                    {authMode === 'register' && (
                      <input value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} placeholder="Business or contractor name" className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary" />
                    )}
                    <input type="email" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} placeholder="Contractor email" className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary" />
                    {authMode === 'register' && (
                      <>
                        <input value={authForm.phone} onChange={e => setAuthForm({...authForm, phone: e.target.value})} placeholder="Phone number" className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary" />
                        <input value={contractorForm.service_area} onChange={e => setContractorForm({...contractorForm, service_area: e.target.value})} placeholder="Service area (e.g. Zone 4)" className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary" />
                        <input value={contractorForm.skills} onChange={e => setContractorForm({...contractorForm, skills: e.target.value})} placeholder="Skills (Roads, Asphalt, Plumbing, Electrical)" className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary" />
                        <input value={contractorForm.payout_account_id} onChange={e => setContractorForm({...contractorForm, payout_account_id: e.target.value})} placeholder="Stripe Connect account (acct_…)" className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary" />
                      </>
                    )}
                    <input type="password" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} placeholder="Password" className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary" />
                    {authMode === 'register' && (
                      <input type="password" value={authForm.confirmPassword} onChange={e => setAuthForm({...authForm, confirmPassword: e.target.value})} placeholder="Confirm password" className="w-full glass-input rounded-lg p-3 text-xs sm:text-sm text-ink-primary" />
                    )}
                    {authError && <div className="text-xs text-red-400 bg-transparent border border-red-500 p-2.5 rounded-lg">{authError}</div>}
                    <button onClick={authenticateContractor} disabled={authBusy} className="w-full py-3.5 rounded-lg bg-primary-container text-on-primary-container font-mono font-bold uppercase border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-40">
                      {authBusy ? 'Authenticating…' : authMode === 'register' ? 'Submit Registration' : 'Contractor Sign In'}
                    </button>
                  </div>
                  {authUser && <button onClick={logout} className="block mx-auto text-xs text-ink-secondary hover:text-ink-primary underline">Log out of current session</button>}
                </div>
              ) : (
                <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 space-y-7 reveal-up">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] p-6 rounded-lg shadow-xl">
                    <div>
                      <div className="text-[10px] font-mono tracking-widest text-accent-electric-cyan font-bold uppercase">CONTRACTOR OPERATIONS PORTAL</div>
                      <h1 className="text-xl sm:text-2xl font-extrabold text-ink-primary mt-1">{contractorProfile?.name || 'Contractor Hub'}</h1>
                      <p className="text-xs text-ink-secondary mt-0.5 font-mono">Status: {contractorProfile?.approval_status || 'Approved'} · Rating: ★ {contractorProfile?.rating || '5.0'}</p>
                    </div>
                    <button onClick={logout} className="px-4 py-2 rounded-lg bg-surface-container border-2 border-border-black text-xs font-semibold text-ink-secondary">
                      Log out
                    </button>
                  </div>

                  <div className="space-y-4">
                    <h2 className="text-sm font-bold text-ink-primary font-mono uppercase tracking-wider">Assigned Work Orders</h2>
                    {contractorJobs.map(job => (
                      <div key={job.offer_id} className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6 space-y-3 shadow-xl">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-mono text-accent-electric-cyan font-bold">{job.offer_id} · {job.complaint_id}</div>
                            <h3 className="text-base font-bold text-ink-primary mt-0.5">{job.issue_title}</h3>
                            <p className="text-xs text-ink-secondary mt-1 font-mono">{job.work_location_area} · Budget: BDT {Number(job.budget_cap).toLocaleString()} · SLA: {job.sla_hours}h</p>
                          </div>
                          <span className="text-xs font-mono font-bold text-status-warning-amber bg-status-warning-amber/10 border-2 border-status-warning-amber px-3 py-1 rounded-full h-fit">
                            {job.status}
                          </span>
                        </div>
                        <div className="flex gap-2.5 pt-2">
                          {job.status === 'Sent' && (
                            <>
                              <button onClick={() => updateContractorJob(job, 'Rejected')} className="px-4 py-2 rounded-lg border border-red-500 text-red-400 hover:bg-transparent text-xs font-bold transition-colors">
                                Reject
                              </button>
                              <button onClick={() => updateContractorJob(job, 'Accepted')} className="px-5 py-2 rounded-lg bg-status-live-green hover:opacity-90 text-on-primary-container text-xs font-mono font-bold border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] transition-all">
                                Accept Order
                              </button>
                            </>
                          )}
                          {job.status === 'Accepted' && (
                            <button onClick={() => updateContractorJob(job, 'In Progress')} className="px-5 py-2 rounded-lg bg-primary-container hover:bg-primary-container text-on-primary-container text-xs font-bold transition-colors shadow-md">
                              Start Work On-Site
                            </button>
                          )}
                          {job.status === 'In Progress' && (
                            <div className="w-full grid gap-2 sm:grid-cols-2">
                              <label className="glass-input rounded-lg p-3 text-xs text-ink-secondary cursor-pointer"><span>{contractorProofs[job.offer_id]?.image?.name || 'Choose completion photo'}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),image:e.target.files?.[0] || null}})} /></label>
                              <input type="url" value={contractorProofs[job.offer_id]?.report_url || ''} onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),report_url:e.target.value}})} placeholder="Public Google Drive report link" className="glass-input rounded-lg p-3 text-xs text-ink-primary" />
                              <textarea value={contractorProofs[job.offer_id]?.note || ''} onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),note:e.target.value}})} placeholder="Short completion summary" rows="2" className="sm:col-span-2 glass-input rounded-lg p-3 text-xs text-ink-primary resize-none" />
                              <label className="sm:col-span-2 flex items-start gap-2.5 rounded-lg border-2 border-border-black bg-surface-container p-3 text-xs text-ink-secondary cursor-pointer">
                                <input type="checkbox" checked={Boolean(contractorProofs[job.offer_id]?.public_access_confirmed)} onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),public_access_confirmed:e.target.checked}})} className="mt-0.5 accent-sky-500" />
                                <span>I confirm the Google Drive report is set to <strong className="text-ink-primary">Anyone with the link can view</strong>.</span>
                              </label>
                              <button onClick={() => updateContractorJob(job, 'Proof Submitted')} className="sm:col-span-2 px-5 py-2.5 rounded-lg bg-status-live-green hover:opacity-90 text-on-primary-container text-xs font-mono font-bold border-2 border-border-black">Submit completed work for review</button>
                            </div>
                          )}
                          {job.status === 'Proof Submitted' && <p className="text-xs text-status-live-green">Completion proof submitted. Waiting for authority verification.</p>}
                        </div>
                      </div>
                    ))}
                    {!contractorJobs.length && (
                      <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-12 text-center text-xs text-ink-secondary">
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
                    <button onClick={logout} className="block mx-auto text-xs text-ink-secondary hover:text-ink-primary underline">
                      Log out of {authUser.email} first
                    </button>
                  )}
                </div>
              ) : (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8 reveal-up">
                  {/* COMMAND HEADER */}
                  <div className="bg-surface-clean border-2 border-border-black shadow-[4px_4px_0px_var(--shadow-color)] p-6 sm:p-8 rounded-lg space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-border-black/30 pb-6">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-container border border-border-black font-mono text-[10px] uppercase font-bold text-ink-primary shadow-[1px_1px_0px_var(--shadow-color)]">
                            <span className="w-2 h-2 rounded-full bg-status-live-green shadow-[0_0_8px_#10B981]"></span>
                            <span>MUNICIPAL OPERATIONS GATE</span>
                          </div>
                          {authUser?.role === 'officer' && (
                            <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded border border-border-black bg-primary-container text-on-primary-container uppercase shadow-[1px_1px_0px_var(--shadow-color)]">
                              Authority Scoped: {authUser.authority_id}
                            </span>
                          )}
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-status-warning-amber bg-status-warning-amber/10 text-status-warning-amber font-bold uppercase">
                            CIVIC CADASTRE
                          </span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black font-headline text-ink-primary uppercase tracking-tight">
                          {authUser?.role === 'officer' ? `${authUser.name} Operations Hub` : 'Authority Command Dashboard'}
                        </h1>
                        <p className="text-xs sm:text-sm text-ink-secondary mt-1">
                          {authUser?.role === 'officer'
                            ? `Active Jurisdictional Officer · ${authUser.department || 'Road & Civil Infrastructure Maintenance'}`
                            : 'Executive dispatch console: review priority incidents, verify completion proofs, and audit municipal SLAs.'}
                        </p>
                      </div>

                      {/* Active Officer Status & Prominent Log Out */}
                      <div className="flex items-center gap-3 shrink-0 self-start md:self-center">
                        <div className="hidden sm:flex flex-col text-right">
                          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-subtle">Authenticated As</span>
                          <span className="font-mono text-xs font-bold text-ink-primary">{authUser?.name || authUser?.email}</span>
                        </div>
                        <button 
                          onClick={logout} 
                          title="Sign out of authority session"
                          className="px-3.5 py-2 border-2 border-border-black bg-surface-container hover:bg-red-500 hover:text-white text-ink-primary font-mono text-xs font-bold uppercase shadow-[2px_2px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Icon name="log-out" className="w-3.5 h-3.5" />
                          <span>Log Out</span>
                        </button>
                      </div>
                    </div>

                    {/* SUB-NAVIGATION TAB RIBBON */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
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
                          className={`px-4 py-2 rounded font-mono text-xs font-bold uppercase border-2 transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
                            adminView === id
                              ? 'bg-primary-container text-on-primary-container font-black border-border-black shadow-[2px_2px_0px_var(--shadow-color)]'
                              : 'bg-surface-clean border-border-black text-ink-secondary hover:text-ink-primary hover:bg-surface-container shadow-[2px_2px_0px_var(--shadow-color)]'
                          }`}
                        >
                          <Icon name={icon} className="w-3.5 h-3.5" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* KPI STATS ROW */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: 'Human Review', val: reports.filter(r => r.needs_review || r.status === 'Needs Review').length, alert: true, icon: 'user-check' },
                      { label: 'Proof Reviews', val: reports.filter(r => r.status === 'Evidence Uploaded').length, alert: false, icon: 'clipboard-check' },
                      { label: 'SLA Overdue', val: dashboard?.stats?.overdue_cases ?? reports.filter(r => (r.sla_status || '').startsWith('Overdue')).length, alert: true, icon: 'clock' },
                      { label: 'Active Work', val: dashboard?.stats?.active_issues ?? reports.filter(r => r.status !== 'Resolved').length, alert: false, icon: 'inbox' }
                    ].map((kpi, idx) => (
                      <div key={idx} className={`bg-surface-clean border-2 shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-5 transition-all ${kpi.alert && kpi.val > 0 ? 'border-red-500 bg-red-500/10' : 'border-border-black'}`}>
                        <div className="flex items-center justify-between text-ink-secondary">
                          <span className="text-xs font-mono font-bold uppercase">{kpi.label}</span>
                          <Icon name={kpi.icon} className={`w-4 h-4 ${kpi.alert && kpi.val > 0 ? 'text-red-400' : 'text-accent-electric-cyan'}`} />
                        </div>
                        <div className={`text-3xl font-black font-mono mt-2 tracking-tight ${kpi.alert && kpi.val > 0 ? 'text-red-400' : 'text-ink-primary'}`}>
                          {kpi.val}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* AI GOVERNANCE INSIGHT */}
                  {dashboard?.insight && (
                    <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-5 flex items-start gap-3.5">
                      <div className="w-9 h-9 rounded-lg bg-surface-container border border-border-black flex items-center justify-center text-accent-electric-cyan shrink-0">
                        <Icon name="sparkles" className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-mono font-bold uppercase text-accent-electric-cyan">Suggested Priority Summary</div>
                        <p className="text-xs sm:text-sm text-ink-primary mt-1 leading-relaxed">{dashboard.insight}</p>
                      </div>
                    </div>
                  )}

                  {/* QUEUE FILTERS */}
                  {['queue', 'map', 'review', 'proofs'].includes(adminView) && (
                    <div className="bg-surface-clean border-2 border-border-black shadow-[4px_4px_0px_var(--shadow-color)] rounded-lg p-5 sm:p-6 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-black font-headline uppercase text-ink-primary">Find and filter cases</h2>
                          <p className="text-xs text-ink-secondary mt-0.5">Showing {filteredAdminReports.length} of {reports.length} municipal incidents</p>
                        </div>
                        <button onClick={resetQueueFilters} className="text-xs text-accent-electric-cyan hover:underline font-mono font-bold uppercase cursor-pointer">
                          Reset All Filters
                        </button>
                      </div>

                      <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
                        <input
                          type="search"
                          aria-label="Search incidents"
                          placeholder="Search ID, area, type…"
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          className="lg:col-span-2 glass-input rounded-lg px-3.5 py-2.5 text-xs text-ink-primary"
                        />
                        <select aria-label="Reported within" value={queueFilters.days} onChange={e => setQueueFilters({ ...queueFilters, days: e.target.value })} className="glass-input rounded-lg px-3 py-2.5 text-xs text-ink-primary">
                          <option value="all" className="bg-surface-container">Any age</option>
                          <option value="1" className="bg-surface-container">Last 24 hours</option>
                          <option value="7" className="bg-surface-container">Last 7 days</option>
                          <option value="15" className="bg-surface-container">Last 15 days</option>
                          <option value="30" className="bg-surface-container">Last 30 days</option>
                        </select>
                        <select aria-label="Work state" value={queueFilters.state} onChange={e => setQueueFilters({ ...queueFilters, state: e.target.value })} className="glass-input rounded-lg px-3 py-2.5 text-xs text-ink-primary">
                          <option value="all" className="bg-surface-container">All statuses</option>
                          <option value="needs_action" className="bg-surface-container">Needs action</option>
                          <option value="assigned" className="bg-surface-container">Assigned</option>
                          <option value="unresolved" className="bg-surface-container">Unresolved</option>
                          <option value="resolved" className="bg-surface-container">Resolved</option>
                        </select>
                        <select aria-label="Category" value={queueFilters.category} onChange={e => setQueueFilters({ ...queueFilters, category: e.target.value })} className="glass-input rounded-lg px-3 py-2.5 text-xs text-ink-primary">
                          <option value="all" className="bg-surface-container">All categories</option>
                          {reportCategories.map(category => <option key={category} value={category} className="bg-surface-container">{category}</option>)}
                        </select>
                        <select aria-label="Severity" value={queueFilters.severity} onChange={e => setQueueFilters({ ...queueFilters, severity: e.target.value })} className="glass-input rounded-lg px-3 py-2.5 text-xs text-ink-primary">
                          <option value="all" className="bg-surface-container">All severities</option>
                          {['Critical', 'High', 'Medium', 'Low'].map(level => <option key={level} value={level} className="bg-surface-container">{level}</option>)}
                        </select>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-ink-secondary font-bold uppercase">Sort:</span>
                        {[
                          ['priority', 'Highest Priority'],
                          ['oldest', 'Oldest First'],
                          ['newest', 'Newest First']
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            onClick={() => setQueueFilters({ ...queueFilters, sort: value })}
                            className={`px-3 py-1.5 rounded border-2 text-[11px] font-mono font-bold uppercase transition-all cursor-pointer ${
                              queueFilters.sort === value
                                ? 'border-border-black bg-primary-container text-on-primary-container shadow-[2px_2px_0px_var(--shadow-color)]'
                                : 'border-border-black bg-surface-clean text-ink-secondary hover:text-ink-primary shadow-[1px_1px_0px_var(--shadow-color)]'
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
                    <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-5 sm:p-6 space-y-4">
                      <div className="flex justify-between items-center">
                        <h2 className="text-sm font-bold text-ink-primary font-mono uppercase tracking-wider">Filtered Incident Telemetry Map</h2>
                        <span className="text-xs font-mono text-ink-secondary">{filteredAdminReports.filter(r => Number.isFinite(r.coordinates?.lat)).length} mapped coordinates</span>
                      </div>
                      <AuthorityMap reports={filteredAdminReports} useClusters={reportsTruncated} onSelect={report => { setSelectedReport(report); showToast(`${report.id}: ${report.status}`); }} />
                    </div>
                  )}

                  {/* WHATSAPP VIEW */}
                  {adminView === 'whatsapp' && (
                    <div className="space-y-4">
                      <div className="grid sm:grid-cols-3 gap-3">
                        {[
                          ['Total WhatsApp Intake', reports.filter(r => r.channel === 'WhatsApp').length],
                          ['Pending Triage', reports.filter(r => r.channel === 'WhatsApp' && r.status !== 'Resolved').length],
                          ['Resolved via Bot', reports.filter(r => r.channel === 'WhatsApp' && r.status === 'Resolved').length]
                        ].map(([label, value]) => (
                          <div key={label} className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-5">
                            <div className="text-xs text-ink-secondary font-mono">{label}</div>
                            <div className="text-3xl font-extrabold text-ink-primary font-mono mt-1">{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CONTRACTORS VIEW */}
                  {adminView === 'contractors' && (
                    <div className="space-y-3">
                      {contractors.map(contractor => (
                        <div key={contractor.contractor_id} className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-mono text-accent-electric-cyan font-bold">{contractor.contractor_id}</div>
                            <div className="text-base font-bold text-ink-primary mt-0.5">{contractor.name}</div>
                            <div className="text-xs text-ink-secondary mt-1 font-mono">
                              {contractor.service_area} · {(contractor.skills || []).join(', ') || 'General Works'} · {contractor.approval_status || (contractor.verified ? 'Approved' : 'Pending Verification')}
                            </div>
                          </div>
                          {!contractor.verified && (
                            <div className="flex gap-2">
                              <button onClick={() => approveContractor(contractor, false)} className="px-4 py-2 rounded-lg border border-red-500 text-red-400 text-xs font-bold">
                                Reject
                              </button>
                              <button onClick={() => approveContractor(contractor, true)} className="px-5 py-2 rounded-lg bg-status-live-green text-on-primary-container text-xs font-mono font-bold border-2 border-border-black">
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
                    <div className="space-y-4">
                      <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6">
                        <h2 className="text-sm font-bold text-ink-primary font-mono uppercase tracking-wider">Community Repair Escrow Dispatch</h2>
                        <p className="text-xs text-ink-secondary mt-1">Review applicant work plans, lock budget in escrow, inspect completion proof photos, and release funds.</p>
                      </div>
                      {repairRequests.length ? repairRequests.map(req => (
                        <div key={req.request_id} className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-6 grid lg:grid-cols-[1fr_300px] gap-6 shadow-xl">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-mono text-accent-electric-cyan font-bold">{req.request_id}</span>
                              <span className="text-xs font-mono text-ink-secondary">Incident: {req.complaint_id}</span>
                              <span className="px-2.5 py-0.5 rounded-full bg-status-warning-amber/10 border-2 border-status-warning-amber text-[10px] font-mono text-status-warning-amber font-bold">{req.status}</span>
                            </div>
                            <div className="text-lg font-bold text-ink-primary mt-2">{req.applicant_name} · BDT {Number(req.estimated_price).toLocaleString()}</div>
                            <div className="text-xs text-ink-secondary mt-0.5 font-mono">Contact: {req.applicant_contact} · Est. Hours: {req.estimated_hours}h</div>
                            <div className="mt-4 p-4 rounded-lg bg-surface border-2 border-border-black">
                              <div className="text-[10px] font-mono text-ink-secondary mb-1 font-bold">SUBMITTED WORK PLAN</div>
                              <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed">{req.plan}</p>
                            </div>
                            {req.proof && (
                              <div className="mt-4 flex items-center gap-3 bg-surface-container border-2 border-border-black p-3 rounded-lg">
                                <img src={absoluteMediaUrl(req.proof.after_image_url)} className="w-24 h-20 object-cover rounded-lg border-2 border-border-black" alt="Completion proof" />
                                <div>
                                  <div className="text-xs text-status-live-green font-bold">Youth completion photo uploaded</div>
                                  <div className="text-xs text-ink-secondary mt-1">{req.proof.completion_note}</div>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            <div className="rounded-lg bg-surface-container border-2 border-border-black p-4">
                              <div className="text-[10px] font-mono text-ink-secondary font-bold">ESCROW STATUS</div>
                              <div className="text-xs text-ink-primary mt-1">{req.funds_status}</div>
                              {req.approved_budget && <div className="text-xl font-extrabold text-status-live-green font-mono mt-1">BDT {Number(req.approved_budget).toLocaleString()}</div>}
                            </div>
                            {req.status === 'Pending Admin Review' && (
                              <>
                                <label className="block text-xs text-ink-secondary font-mono">Approved Escrow Amount
                                  <input type="number" value={fundingBudgets[req.request_id] ?? req.estimated_price} onChange={e => setFundingBudgets({ ...fundingBudgets, [req.request_id]: e.target.value })} className="mt-1 w-full glass-input rounded-lg p-2.5 text-xs text-ink-primary font-mono" />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <button onClick={() => decideRepair(req, false)} className="px-3 py-2 rounded-lg border border-red-500 text-red-400 text-xs font-bold">Reject</button>
                                  <button onClick={() => decideRepair(req, true)} className="px-3 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-mono font-bold uppercase border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)]">Reserve Escrow</button>
                                </div>
                              </>
                            )}
                            {req.status === 'Approved - Awaiting Work' && (
                              <div className="rounded-lg bg-status-warning-amber/10 border-2 border-status-warning-amber p-3.5 text-xs text-status-warning-amber leading-snug">
                                Waiting for youth worker on-site execution and after photo upload.
                              </div>
                            )}
                            {req.status === 'Proof Submitted - Awaiting Verification' && (
                              <button onClick={() => releaseFunds(req)} className="w-full py-3 rounded-lg bg-status-live-green hover:bg-status-live-green text-on-primary-container text-xs font-bold shadow-lg shadow-status-live-green transition-all">
                                ✓ Verify Proof & Release Funds
                              </button>
                            )}
                          </div>
                        </div>
                      )) : (
                        <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg p-10 text-center text-xs text-ink-secondary">
                          No community funding requests currently awaiting review.
                        </div>
                      )}
                    </div>
                  )}

                  {/* WORK QUEUE VIEW */}
                  {['queue', 'review', 'proofs'].includes(adminView) && (
                    <div className="bg-surface-clean border-2 border-border-black shadow-[3px_3px_0px_var(--shadow-color)] rounded-lg overflow-hidden shadow-2xl">
                      <div className="px-6 py-4 border-b-2 border-border-black/30 flex items-center justify-between">
                        <h2 className="text-xs font-bold text-ink-primary font-mono uppercase tracking-wider">{adminView === 'proofs' ? 'Contractor proof review' : adminView === 'review' ? 'Human review queue' : 'Municipal work queue'}</h2>
                        <span className="text-xs font-mono text-ink-secondary">{displayedAdminReports.length} shown</span>
                      </div>

                      {/* INCIDENT WORKSPACE DRAWER */}
                      {(operationLoading || operationDetail) && (
                        <div className="border-b-2 border-border-black/30 p-6 bg-surface reveal-up">
                          {operationLoading ? (
                            <div className="text-xs text-ink-secondary font-mono">Loading incident workspace…</div>
                          ) : (
                            <div className="space-y-5">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="text-xs font-mono text-accent-electric-cyan font-bold">INCIDENT WORKSPACE · {operationDetail.complaint.id}</div>
                                  <h3 className="text-lg font-bold text-ink-primary mt-0.5">{operationDetail.complaint.title}</h3>
                                  <p className="text-xs text-ink-secondary mt-0.5 font-mono">{operationDetail.complaint.location}</p>
                                </div>
                                <button onClick={() => setOperationDetail(null)} className="text-ink-secondary hover:text-ink-primary text-lg font-bold">×</button>
                              </div>

                              <div className="grid lg:grid-cols-[240px_1fr] gap-5">
                                {operationDetail.complaint.beforeImage ? (
                                  <img src={operationDetail.complaint.beforeImage} alt="Citizen evidence" className="w-full h-48 object-cover rounded-lg border-2 border-border-black shadow-md" />
                                ) : (
                                  <div className="h-48 rounded-lg bg-surface-container border-2 border-border-black flex items-center justify-center text-xs text-ink-subtle">
                                    No photo evidence supplied
                                  </div>
                                )}
                                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                                  <div className="p-3.5 rounded-lg bg-surface-container border-2 border-border-black">
                                    <div className="text-ink-secondary font-mono text-[10px] font-bold">CITIZEN INPUT</div>
                                    <p className="text-ink-primary mt-1.5 leading-relaxed">{operationDetail.complaint.description}</p>
                                  </div>
                                  <div className="p-3.5 rounded-lg bg-surface-container border-2 border-border-black">
                                    <div className="text-ink-secondary font-mono text-[10px] font-bold">AI VISION ASSESSMENT</div>
                                    <div className="text-ink-primary font-bold mt-1.5">{operationDetail.complaint.category} · {operationDetail.complaint.severity}</div>
                                    <p className="text-ink-secondary mt-1 text-[11px] leading-snug">{operationDetail.complaint.ai_reasoning || operationDetail.complaint.title}</p>
                                    <div className="text-accent-electric-cyan font-mono text-[11px] mt-1.5">Confidence: {operationDetail.complaint.confidence}</div>
                                  </div>
                                  <div className="sm:col-span-2 p-3.5 rounded-lg bg-surface-container border-2 border-border-black">
                                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                                      <div className="text-ink-secondary font-mono text-[10px] font-bold">ASSIGNED RESPONSIBLE AUTHORITY</div>
                                      <div className="flex flex-wrap items-center gap-1">
                                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-warning-amber/10 text-status-warning-amber border border-status-warning-amber">
                                          {operationDetail.complaint.assigned_authority?.authority_data_status === 'gazette_verified' ? 'Gazette Verified' : 'Candidate Authority'}
                                        </span>
                                        {operationDetail.complaint.assigned_authority?.jurisdiction_data_status === 'statutory_polygon_verified' ? (
                                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-live-green/10 text-status-live-green border border-status-live-green">
                                            Statutory Verified
                                          </span>
                                        ) : operationDetail.complaint.assigned_authority?.jurisdiction_data_status === 'heuristic_bbox' ? (
                                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-warning-amber/10 text-status-warning-amber border border-status-warning-amber">
                                            Heuristic Area
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-container text-accent-electric-cyan border border-border-black">
                                            Location Inferred
                                          </span>
                                        )}
                                        {operationDetail.complaint.assigned_authority?.assignment_status === 'officer_assigned' && (
                                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-container border-2 border-border-black text-ink-secondary">
                                            Officer Assigned
                                          </span>
                                        )}
                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-canvas-paper text-ink-secondary border-2 border-border-black">
                                          Simulated Workflow
                                        </span>
                                      </div>
                                    </div>
                                    <div className="mt-2 text-ink-primary font-semibold flex items-center gap-2">
                                      <Icon name="building-2" className="w-4 h-4 text-accent-electric-cyan" />
                                      <span>
                                        {operationDetail.complaint.assigned_authority?.authority_name
                                          ? `${operationDetail.complaint.assigned_authority.authority_name} (${operationDetail.complaint.assigned_authority.short_code})`
                                          : (operationDetail.complaint.needs_review || operationDetail.complaint.department === 'Needs Review' ? 'Awaiting Authority Review' : operationDetail.complaint.department)}
                                      </span>
                                    </div>
                                    {operationDetail.complaint.assigned_authority?.department && operationDetail.complaint.assigned_authority?.authority_name && (
                                      <div className="text-[11px] text-ink-secondary mt-1 pl-6">
                                        Department: <span className="text-ink-primary font-medium">{operationDetail.complaint.assigned_authority.department}</span>
                                      </div>
                                    )}
                                    {operationDetail.complaint.assigned_authority?.jurisdiction && (
                                      <div className="text-[11px] text-ink-secondary mt-0.5 pl-6 flex items-center gap-1.5">
                                        <Icon name="map-pin" className="w-3 h-3 text-accent-electric-cyan" />
                                        <span>Jurisdiction: {operationDetail.complaint.assigned_authority.jurisdiction}</span>
                                        {operationDetail.complaint.assigned_authority.routing_method && (
                                          <span className="font-mono text-[10px] text-ink-subtle">({operationDetail.complaint.assigned_authority.routing_method})</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="sm:col-span-2 p-3.5 rounded-lg bg-surface-container border border-border-black">
                                    <div className="text-accent-electric-cyan font-mono text-[10px] font-bold">RECOMMENDED NEXT ACTION</div>
                                    <p className="text-ink-primary mt-1 text-xs">{operationDetail.recommended_action}</p>
                                  </div>
                                </div>
                              </div>

                              {/* SIMULATED FIELD OFFICER WORKFLOW CONTROLS */}
                              {(authUser?.role === 'officer' || authUser?.role === 'admin') && (
                                <div data-testid="officer-workflow-controls" className="rounded-lg border border-border-black bg-surface-container p-4 space-y-4">
                                  <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-border-black/30 pb-2.5">
                                    <div className="text-xs font-bold font-mono text-accent-electric-cyan flex items-center gap-2">
                                      <Icon name="briefcase" className="w-4 h-4 text-accent-electric-cyan" />
                                      <span>SIMULATED FIELD OFFICER WORKFLOW</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-canvas-paper text-ink-secondary border-2 border-border-black">
                                        Current Status: {operationDetail.complaint.status}
                                      </span>
                                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-status-warning-amber/10 text-status-warning-amber border border-status-warning-amber">
                                        Simulated Demo
                                      </span>
                                    </div>
                                  </div>

                                  {/* Acknowledge Button */}
                                  {['Submitted', 'Assigned'].includes(operationDetail.complaint.status) && operationDetail.complaint.assigned_authority?.routing_status === 'assigned' && (
                                    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-surface-container border-2 border-border-black">
                                      <div>
                                        <div className="text-xs font-bold text-ink-primary">Step 1: Acknowledge Assignment</div>
                                        <div className="text-[11px] text-ink-secondary">Confirm authority ownership and dispatch inspection crew.</div>
                                      </div>
                                      <button
                                        onClick={() => handleOfficerStatusUpdate('Acknowledged', 'Officer acknowledged incident and dispatched inspection team.')}
                                        className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-mono font-bold uppercase border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] transition-all flex items-center gap-1.5"
                                      >
                                        <Icon name="check" className="w-4 h-4" />
                                        <span>Acknowledge Incident</span>
                                      </button>
                                    </div>
                                  )}

                                  {/* Reopened Incident Reinspection Card */}
                                  {operationDetail.complaint.status === 'Reopened - Needs Review' && (
                                    <div className="p-4 rounded-lg bg-status-warning-amber/10 border-2 border-status-warning-amber space-y-3">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span className="text-status-warning-amber font-bold text-xs uppercase font-mono tracking-wider">Citizen Dispute · Reinspection Required</span>
                                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-transparent border border-red-500 text-red-400 font-bold">
                                            {operationDetail.complaint.citizen_verification?.outcome || 'not_fixed'}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="text-xs text-ink-secondary bg-surface-container p-2.5 rounded-lg border-2 border-border-black">
                                        <span className="text-ink-secondary font-semibold">Citizen feedback: </span>
                                        {operationDetail.complaint.citizen_verification?.note || operationDetail.complaint.review_reason || 'Citizen disputed resolution completion.'}
                                      </div>
                                      <div className="flex flex-wrap gap-2 pt-1">
                                        <button
                                          onClick={() => handleOfficerStatusUpdate('Acknowledged', 'Officer acknowledged citizen dispute and scheduled reinspection.')}
                                          className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-mono font-bold uppercase border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] transition-all flex items-center gap-1.5"
                                        >
                                          <Icon name="check" className="w-4 h-4" />
                                          <span>Acknowledge Reinspection</span>
                                        </button>
                                        <button
                                          onClick={() => handleOfficerStatusUpdate('In Progress', 'Field team deployed to address citizen dispute.')}
                                          className="px-4 py-2 rounded-lg bg-status-warning-amber hover:opacity-90 text-on-primary-container text-xs font-mono font-bold border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all flex items-center gap-1.5"
                                        >
                                          <Icon name="play" className="w-4 h-4" />
                                          <span>Resume Field Work</span>
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Start Work Button */}
                                  {operationDetail.complaint.status === 'Acknowledged' && (
                                    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-surface-container border-2 border-border-black">
                                      <div>
                                        <div className="text-xs font-bold text-ink-primary">Step 2: Mobilize Crew & Start Work</div>
                                        <div className="text-[11px] text-ink-secondary">Deploy maintenance equipment to site.</div>
                                      </div>
                                      <button
                                        onClick={() => handleOfficerStatusUpdate('In Progress', 'Field maintenance team deployed to site.')}
                                        className="px-4 py-2 rounded-lg bg-status-warning-amber hover:opacity-90 text-on-primary-container text-xs font-mono font-bold border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] hover:shadow-[1px_1px_0px_var(--shadow-color)] hover:translate-x-[1px] hover:translate-y-[1px] transition-all flex items-center gap-1.5"
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
                                        <label className="block text-[10px] font-mono text-ink-secondary uppercase">Field Progress Note</label>
                                        <div className="flex gap-2">
                                          <input
                                            type="text"
                                            placeholder="Add progress note (e.g. materials arriving at 2 PM)..."
                                            value={officerProgressNote}
                                            onChange={(e) => setOfficerProgressNote(e.target.value)}
                                            className="min-w-0 flex-1 glass-input rounded-lg p-2.5 text-xs text-ink-primary font-mono"
                                          />
                                          <button
                                            onClick={handleOfficerProgressUpdate}
                                            className="px-4 py-2 rounded-lg bg-canvas-paper hover:bg-surface-container border-2 border-border-black text-xs font-bold text-accent-electric-cyan transition-all shrink-0"
                                          >
                                            Add Note
                                          </button>
                                        </div>
                                      </div>

                                      {/* Upload Resolution Evidence Form */}
                                      <div className="rounded-lg border-2 border-border-black bg-surface p-3.5 space-y-3">
                                        <div className="text-[11px] font-mono text-status-live-green font-bold uppercase tracking-wider flex items-center gap-1.5">
                                          <Icon name="camera" className="w-3.5 h-3.5" />
                                          <span>Upload Completed Resolution Proof</span>
                                        </div>
                                        <div className="grid sm:grid-cols-2 gap-3">
                                          <div>
                                            <label className="block text-[10px] font-mono text-ink-secondary mb-1 uppercase">Completion Photograph</label>
                                            <input
                                              type="file"
                                              accept="image/*"
                                              onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                                              className="w-full text-xs text-ink-secondary file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-primary-container/20 file:text-accent-electric-cyan hover:file:bg-primary-container/30"
                                            />
                                          </div>
                                          <div>
                                            <label className="block text-[10px] font-mono text-ink-secondary mb-1 uppercase">Completion Notes</label>
                                            <textarea
                                              rows={2}
                                              placeholder="Describe work performed on site..."
                                              value={evidenceNote}
                                              onChange={(e) => setEvidenceNote(e.target.value)}
                                              className="w-full glass-input rounded-lg p-2 text-xs text-ink-primary resize-none"
                                            />
                                          </div>
                                        </div>
                                        <button
                                          disabled={!evidenceFile || !evidenceNote.trim() || isUploadingEvidence}
                                          onClick={handleEvidenceUpload}
                                          className="w-full py-2.5 rounded-lg bg-status-live-green hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-on-primary-container text-xs font-mono font-bold border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] transition-all flex items-center justify-center gap-2"
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
                                    <div className="rounded-lg border-2 border-status-live-green bg-status-live-green/5 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <span className="text-status-live-green flex items-center gap-2">
                                        <Icon name="clock" className="w-4 h-4 text-status-live-green" />
                                        <span>Evidence submitted. Awaiting citizen confirmation gate.</span>
                                      </span>
                                      {operationDetail.complaint.afterImage && (
                                        <a href={operationDetail.complaint.afterImage} target="_blank" rel="noopener noreferrer" className="text-accent-electric-cyan font-mono text-[11px] underline">
                                          View proof photo ↗
                                        </a>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="grid lg:grid-cols-2 gap-5 pt-2">
                                <div>
                                  <div className="text-xs font-mono text-ink-secondary mb-2 font-bold">MATCHED CONTRACTORS</div>
                                  <div className="flex gap-2">
                                    <select value={offerForm.contractor_id} onChange={e => setOfferForm({ ...offerForm, contractor_id: e.target.value })} className="min-w-0 flex-1 glass-input rounded-lg p-2.5 text-xs text-ink-primary">
                                      {operationDetail.contractor_matches.map(c => <option key={c.contractor_id} value={c.contractor_id} className="bg-surface-container">{c.name} · {c.match_score}% Match · ★{c.rating}</option>)}
                                    </select>
                                    <input type="number" placeholder="Budget BDT" value={offerForm.budget_cap} onChange={e => setOfferForm({ ...offerForm, budget_cap: e.target.value })} className="w-28 glass-input rounded-lg p-2.5 text-xs text-ink-primary font-mono" />
                                    <button disabled={operationDetail.complaint.needs_review || operationDetail.offers.some(o => ['Sent','Accepted','In Progress','Proof Submitted','Approved'].includes(o.status))} onClick={assignContractor} className="px-4 py-2.5 rounded-lg bg-primary-container text-on-primary-container text-xs font-mono font-bold uppercase border-2 border-border-black shadow-[2px_2px_0px_var(--shadow-color)] disabled:opacity-35 disabled:cursor-not-allowed">Dispatch Order</button>
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-mono text-ink-secondary mb-2 font-bold">ACTIVE WORK ORDERS</div>
                                  {operationDetail.offers.length ? (
                                    <div className="space-y-2">
                                      {operationDetail.offers.map(offer => (
                                        <div key={offer.offer_id} className="bg-surface-container border-2 border-border-black p-3 rounded-lg text-xs">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                              <span className="text-ink-primary font-bold">{offer.contractor_name}</span>
                                              <span className="text-ink-secondary"> · BDT {Number(offer.budget_cap).toLocaleString()}</span>
                                            </div>
                                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${offer.status === 'Proof Submitted' ? 'bg-status-warning-amber text-status-warning-amber' : offer.status === 'Approved' ? 'bg-status-live-green/10 text-status-live-green' : 'bg-surface-container text-accent-electric-cyan'}`}>{offer.status}</span>
                                          </div>
                                          {offer.status === 'Proof Submitted' && (
                                            <div className="mt-3 grid sm:grid-cols-[88px_1fr] gap-3 rounded-lg border-2 border-status-warning-amber bg-status-warning-amber/5 p-3">
                                              {offer.after_image_url && <img src={absoluteMediaUrl(offer.after_image_url)} alt="Contractor completion evidence" className="h-20 w-full rounded-lg object-cover border-2 border-border-black" />}
                                              <div className="space-y-2 min-w-0">
                                                <p className="text-ink-secondary leading-relaxed">{offer.note || 'Completion proof submitted for final review.'}</p>
                                                <a href={offer.report_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent-electric-cyan font-semibold hover:underline"><Icon name="external-link" className="w-3.5 h-3.5" />Open public Drive report</a>
                                                <div className="flex flex-wrap gap-2 pt-1">
                                                  <button onClick={() => changeOfferStatus(offer, 'In Progress', 'Final review requested changes; contractor must resubmit proof.')} className="px-3 py-2 rounded-lg border-2 border-border-black text-ink-secondary font-semibold">Request changes</button>
                                                  <button onClick={() => changeOfferStatus(offer, 'Approved', 'Final proof approved; contractor payment released.')} className="px-3 py-2 rounded-lg bg-status-live-green text-on-primary-container font-mono font-bold border-2 border-border-black">Approve & release payment</button>
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                          {offer.status === 'Approved' && <div className="mt-2 flex items-center gap-2 text-status-live-green"><Icon name="circle-check" className="w-4 h-4" /><span>Final review approved · Payment released</span></div>}
                                          <div className="flex gap-1.5 mt-2">
                                            {offer.status === 'Sent' && <button onClick={() => changeOfferStatus(offer, 'Accepted')} className="px-2.5 py-1 rounded-lg bg-status-live-green/10 text-status-live-green border border-status-live-green text-[10px] font-bold">Accept</button>}
                                            {offer.status === 'Accepted' && <button onClick={() => changeOfferStatus(offer, 'In Progress')} className="px-2.5 py-1 rounded-lg bg-surface-container text-accent-electric-cyan border border-border-black text-[10px] font-bold">Start</button>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-ink-subtle font-mono bg-surface-container border-2 border-border-black p-3 rounded-lg">No contractor assigned yet.</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* DATA TABLE */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b-2 border-border-black/30 bg-surface-container text-[11px] font-mono text-ink-secondary uppercase">
                              <th className="p-4">ID</th>
                              <th className="p-4">Category & Location</th>
                              <th className="p-4">Severity</th>
                              <th className="p-4">AI Confidence</th>
                              <th className="p-4">Status</th>
                              <th className="p-4 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border-black/20 text-xs">
                            {displayedAdminReports.map((item) => (
                              <tr key={item.id} className="hover:bg-canvas-paper/30 transition-colors">
                                <td className="p-4 font-mono font-bold text-accent-electric-cyan">{item.id}</td>
                                <td className="p-4">
                                  <div className="font-semibold text-ink-primary">{item.category}</div>
                                  <div className="text-[11px] text-ink-secondary font-mono">{item.location}</div>
                                  {item.assigned_authority?.short_code && (
                                    <div className="text-[10px] text-accent-electric-cyan font-mono mt-0.5">
                                      {item.assigned_authority.short_code} • {item.assigned_authority.department || item.department}
                                    </div>
                                  )}
                                </td>
                                <td className="p-4">
                                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${item.severity === 'Critical'
                                      ? 'bg-transparent text-red-400 border-red-500'
                                      : 'bg-status-warning-amber/10 text-status-warning-amber border-status-warning-amber'
                                    }`}>
                                    {item.severity}
                                  </span>
                                </td>
                                <td className="p-4 font-mono text-[11px] text-ink-secondary">
                                  {item.confidence}
                                </td>
                                <td className="p-4">
                                  <span className="text-ink-secondary font-medium font-mono">{item.status}</span>
                                </td>
                                <td className="p-4 text-right">
                                  <div className="flex justify-end gap-2">
                                    {((item.needs_review && item.review_type === 'routing_uncertain') || item.status === 'Needs Review') && (
                                      authUser?.role === 'admin' ? (
                                        <button onClick={() => setReviewReport(item)} className="px-3 py-1.5 rounded bg-status-warning-amber border-2 border-border-black text-black font-mono font-bold uppercase text-xs shadow-[2px_2px_0px_var(--shadow-color)] hover:shadow-none transition-all cursor-pointer">Review AI</button>
                                      ) : (
                                        <span className="px-2.5 py-1 rounded bg-surface-container border-2 border-border-black text-ink-subtle text-[10px] font-mono font-bold uppercase">Admin Review</span>
                                      )
                                    )}
                                    {item.status === 'Reopened - Needs Review' && (
                                      <span className="px-2.5 py-1 rounded bg-status-warning-amber/20 border-2 border-status-warning-amber text-status-warning-amber text-[10px] font-mono font-bold uppercase">Disputed</span>
                                    )}
                                    <button
                                      disabled={!nextOperationalStatus(item) || (item.needs_review && item.review_type === 'routing_uncertain') || item.status === 'Needs Review'}
                                      onClick={() => nextOperationalStatus(item) && updateStatus(item, nextOperationalStatus(item))}
                                      className="px-3 py-1.5 rounded bg-primary-container/20 hover:bg-primary-container hover:text-on-primary-container border-2 border-border-black disabled:opacity-30 text-accent-electric-cyan font-mono font-bold uppercase text-xs transition-all shadow-[2px_2px_0px_var(--shadow-color)] cursor-pointer"
                                    >
                                      {nextOperationalStatus(item) ? `→ ${nextOperationalStatus(item)}` : 'Await proof'}
                                    </button>
                                    <button
                                      onClick={() => inspectIncident(item)}
                                      className="px-3.5 py-1.5 rounded bg-surface-container border-2 border-border-black hover:bg-surface-clean text-ink-primary font-mono font-bold uppercase text-xs transition-all shadow-[2px_2px_0px_var(--shadow-color)] cursor-pointer"
                                    >
                                      Workspace
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {!displayedAdminReports.length && (
                              <tr>
                                <td colSpan="6" className="p-12 text-center text-xs text-ink-secondary">
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
          <footer className="w-full bg-canvas-paper border-t-2 border-border-black py-6 mb-16 lg:mb-0">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 bg-primary-container border border-border-black flex items-center justify-center shadow-[1px_1px_0px_var(--shadow-color)]">
                    <Icon name="check" className="w-3 h-3 text-on-primary-container stroke-[3]" />
                  </div>
                  <span className="font-bold text-ink-primary uppercase">UrbanFix Civic Ledger</span>
                  <span className="text-ink-subtle">v4.8.2-CIV</span>
                </div>
                <span className="text-ink-subtle hidden sm:inline">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-status-live-green shadow-[0_0_6px_#10B981]"></span>
                  <span className="uppercase text-ink-primary">Telemetry: Nominal</span>
                </div>
                <span className="text-ink-subtle hidden sm:inline">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-status-warning-amber"></span>
                  <span className="uppercase text-ink-primary">Dispatch Queue: Normal</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] uppercase">
                <button onClick={() => setActiveTab('community')} className="text-ink-secondary hover:text-ink-primary hover:underline">Community cleanup</button>
                <button onClick={() => setActiveTab('contractor')} className="text-ink-secondary hover:text-ink-primary hover:underline">Contractor portal</button>
                <span className="text-ink-subtle">© 2026 Civil Works Authority</span>
              </div>
            </div>
          </footer>
          <ReviewDialog report={reviewReport} busy={reviewBusy} onClose={() => !reviewBusy && setReviewReport(null)} onConfirm={confirmHumanReview} />
        </div>
      );
    }
