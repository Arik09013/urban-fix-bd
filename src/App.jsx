import React, { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import Icon from './components/Icon.jsx';
import ReviewDialog from './components/ReviewDialog.jsx';

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

    const normalizeReport = (item) => ({
      ...item,
      id: item.complaint_id || item.id,
      title: item.summary || item.title || item.description,
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
      const approvals = report.resolution_approvals || {};
      const approvalCount = ['contractor', 'government'].filter(key => approvals[key]).length;
      if (approvalCount === 2 || report.fully_verified) return { color: '#22c55e', label: 'Verified resolution' };
      if (approvalCount > 0) return { color: '#38bdf8', label: `${approvalCount}/2 resolution approvals` };
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
        const center = located.length ? [located[0].coordinates.lat, located[0].coordinates.lng] : [30.1575, 71.5249];
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
        const center = hasLocation ? [latitude, longitude] : [30.1575, 71.5249];
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
        category: 'Let AI decide',
        title: 'Severe Asphalt Pothole near School Gate',
        location: 'Bosan Road, Sector 3, Multan',
        coordinates: { lat: 30.258, lng: 71.514 },
        severity: 'Critical',
        status: 'In Progress',
        data_label: 'Demo',
        priority_score: 92,
        priority_breakdown: { severity: 46, duplicates_and_affected: 18, age: 8, location_impact: 14, critical_safety: 6 },
        department: 'Dept. of Public Works',
        reportedAt: '2026-08-20T09:12:00Z',
        confidence: 'High Confidence (98.4%)',
        duplicates: 4,
        beforeImage: 'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=800',
        afterImage: null,
        description: 'Deep pothole across the left lane creating severe traffic bottlenecks during morning school hours.',
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
        title: 'Overflowing Municipal Garbage Bin',
        location: 'Main Commercial Market, Block B',
        coordinates: { lat: 30.262, lng: 71.520 },
        severity: 'High',
        status: 'Resolved',
        data_label: 'Demo',
        priority_score: 71,
        priority_breakdown: { severity: 30, duplicates_and_affected: 9, age: 10, location_impact: 17, critical_safety: 5 },
        resolution_approvals: { contractor: true, government: true },
        fully_verified: true,
        department: 'Sanitation Authority',
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
        category: 'Water & Sewage',
        title: 'Main Pipeline Overflow & Standing Water',
        location: 'Gulgasht Colony, Street 14',
        coordinates: { lat: 30.250, lng: 71.508 },
        severity: 'Critical',
        status: 'Pending',
        data_label: 'Demo',
        priority_score: 86,
        priority_breakdown: { severity: 46, duplicates_and_affected: 6, age: 8, location_impact: 20, critical_safety: 6 },
        department: 'Water Supply & Sewerage Board',
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

    function AuthCard({ title, subtitle, mode, setMode, form, setForm, submit, busy, error, allowRegister = true, demoCredentials = false }) {
      const [showPassword, setShowPassword] = useState(false);
      const registering = allowRegister && mode === 'register';
      const emailValid = !allowRegister || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());
      const passwordValid = form.password.length >= (registering ? 8 : 1);
      const passwordsMatch = !registering || form.password === form.confirmPassword;
      const canSubmit = !busy && emailValid && passwordValid && (!registering || (form.name.trim().length >= 2 && passwordsMatch));
      return (
        <div className="max-w-md mx-auto glass-panel border border-slate-700/70 rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="text-center sm:text-left">
            <div className="text-xs font-semibold text-sky-400 mb-2">
              SECURE PORTAL
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{title}</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{subtitle}</p>
          </div>
          {allowRegister && (
            <div className="grid grid-cols-2 bg-slate-950/80 border border-slate-800/80 rounded-xl p-1 shadow-inner">
              <button onClick={()=>setMode('login')} className={`py-2 rounded-lg text-xs font-semibold transition-all ${mode==='login'?'bg-sky-500 text-slate-950 shadow-md':'text-slate-400 hover:text-slate-200'}`}>Login</button>
              <button onClick={()=>setMode('register')} className={`py-2 rounded-lg text-xs font-semibold transition-all ${mode==='register'?'bg-sky-500 text-slate-950 shadow-md':'text-slate-400 hover:text-slate-200'}`}>Register</button>
            </div>
          )}
          {allowRegister && mode==='register' && (
            <>
              <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name" autoComplete="name" className="w-full glass-input rounded-xl p-3 text-sm focus:outline-none"/>
              <input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="Phone number (optional)" autoComplete="tel" className="w-full glass-input rounded-xl p-3 text-sm focus:outline-none"/>
              <input value={form.payoutAccount || ''} onChange={e=>setForm({...form,payoutAccount:e.target.value})} placeholder="Stripe Connect account for payments (acct_…)" className="w-full glass-input rounded-xl p-3 text-sm focus:outline-none"/>
            </>
          )}
          {demoCredentials && (
            <button type="button" onClick={() => setForm({...form, email:'admin', password:'admin'})} className="w-full rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-left text-xs text-sky-300 hover:bg-sky-500/20 transition-colors">
              <span className="block font-bold">Judge demo access</span>
              <span className="font-mono">Username: admin · Password: admin</span>
            </button>
          )}
          <input type={allowRegister?'email':'text'} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder={allowRegister ? 'Email address' : 'Admin username'} autoComplete="username" className="w-full glass-input rounded-xl p-3 text-sm focus:outline-none"/>
          <div className="relative">
            <input type={showPassword?'text':'password'} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Password" autoComplete={mode==='register'?'new-password':'current-password'} onKeyDown={e=>e.key==='Enter'&&canSubmit&&submit()} className="w-full glass-input rounded-xl p-3 pr-16 text-sm focus:outline-none"/>
            <button type="button" onClick={()=>setShowPassword(value=>!value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400 hover:text-sky-400">{showPassword?'Hide':'Show'}</button>
          </div>
          {registering && (
            <>
              <input type={showPassword?'text':'password'} value={form.confirmPassword} onChange={e=>setForm({...form,confirmPassword:e.target.value})} placeholder="Confirm password" autoComplete="new-password" onKeyDown={e=>e.key==='Enter'&&canSubmit&&submit()} className={`w-full glass-input rounded-xl p-3 text-sm focus:outline-none ${form.confirmPassword && !passwordsMatch?'border-red-500/60':'border-slate-800'}`}/>
              <div className="flex justify-between text-[10px] font-mono px-1">
                <span className={passwordValid?'text-emerald-400':'text-slate-500'}>{passwordValid?'✓ 8+ chars':'Min 8 characters'}</span>
                {form.confirmPassword && <span className={passwordsMatch?'text-emerald-400':'text-red-400'}>{passwordsMatch?'✓ Passwords match':'Passwords do not match'}</span>}
              </div>
            </>
          )}
          {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2"><Icon name="alert-circle" className="w-4 h-4 text-red-400 shrink-0"/><span>{error}</span></div>}
          <button onClick={()=>submit()} disabled={!canSubmit} className="w-full py-3.5 rounded-xl bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-slate-950 font-bold text-sm transition-colors">
            {busy?'Authenticating…':mode==='register'?'Create account':'Sign in'}
          </button>
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
          if (analysis.is_civic_issue === false) {
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
            description: form.description.trim() || analysis.summary || 'Civic issue shown in uploaded evidence',
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
        'Submitted': 'Assigned', 'Needs Review': 'Assigned', 'Assigned': 'Acknowledged',
        'Contractor Offer Sent': 'Acknowledged', 'Acknowledged': 'In Progress', 'Reopened - Needs Review': 'Assigned'
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
        const searchable = `${item.id} ${item.title || ''} ${item.category} ${item.location} ${item.status}`.toLowerCase();
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
        <div className="min-h-screen flex flex-col bg-[#0B0F17] transition-colors duration-200">
          <a href="#main-content" className="skip-link">Skip to main content</a>
          {/* HEADER / NAVIGATION */}
          <header className="sticky top-0 z-50 bg-[#070A11] border-b border-slate-800/80">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
              <button aria-label="UrbanFix home" className="flex shrink-0 items-center gap-2.5 text-left rounded-xl focus:outline-none" onClick={() => setActiveTab('landing')}>
                <img src="/assets/urbanfix-logo.svg" width="36" height="36" alt="" className="h-9 w-9 rounded-xl" />
                <div className="font-extrabold text-lg tracking-tight text-white flex items-center font-sans whitespace-nowrap">
                    <span>URBAN</span><span className="text-sky-400">FIX</span>
                </div>
              </button>

              <nav className="hidden lg:flex min-w-0 items-center gap-1 p-1 rounded-xl bg-slate-900/50 border border-slate-800/80">
                {[
                  { id: 'landing', label: 'Home', icon: 'home' },
                  { id: 'report', label: 'Report Issue', icon: 'camera' },
                  { id: 'track', label: 'Track Report', icon: 'search' },
                  { id: 'map', label: 'Public Map', icon: 'map' }
                ].map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { if (tab.id === 'track') { setSelectedReport(null); setSubmittedReportId(''); } setActiveTab(tab.id); }}
                      aria-current={isActive ? 'page' : undefined}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                        isActive 
                          ? 'bg-sky-400 text-slate-950 font-bold'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                    >
                      <Icon name={tab.icon} className={`w-3.5 h-3.5 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              <div className="flex shrink-0 items-center">
                <button onClick={() => setDarkMode(value => !value)} aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} title={`Switch to ${darkMode ? 'light' : 'dark'} mode`} className="mr-2 w-9 h-9 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-sky-400 flex items-center justify-center transition-colors">
                  <Icon name={darkMode ? 'sun' : 'moon'} className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setActiveTab('admin')}
                  aria-label="Authority Portal"
                  className="p-2.5 sm:px-3.5 sm:py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-sky-400 border border-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <Icon name="shield-alert" className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">Authority Portal</span>
                </button>
              </div>
            </div>
          </header>

          {/* MOBILE BOTTOM NAVIGATION */}
          <nav aria-label="Mobile navigation" className="mobile-nav lg:hidden fixed bottom-0 inset-x-0 z-50 bg-[#070A11] border-t border-slate-800 px-2 pt-2 grid grid-cols-4 shadow-[0_-8px_20px_rgba(0,0,0,0.35)]">
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
                  className={`min-w-0 min-h-12 rounded-lg flex flex-col items-center justify-center gap-1 py-1 text-[10px] font-semibold transition-colors ${
                    isActive ? 'text-sky-400 bg-sky-500/15' : 'text-slate-500 hover:text-slate-300'
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
            <div role="status" aria-live="polite" className="fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50 reveal-up">
              <div className="glass-panel border border-sky-500/40 text-slate-100 px-4 py-3 rounded-xl shadow-xl flex items-center gap-3">
                <Icon name="activity" className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="text-xs sm:text-sm font-medium leading-snug">{toast}</span>
              </div>
            </div>
          )}

          {/* MAIN BODY ROUTING */}
          <main id="main-content" className="flex-1" tabIndex="-1">
            {/* 1. LANDING PAGE */}
            {activeTab === 'landing' && (
              <div className="relative overflow-hidden">
                <div aria-hidden="true" className="surface-grid absolute inset-0 pointer-events-none" />
                <div aria-hidden="true" className="aurora-glow absolute top-0 inset-x-0 h-[600px] pointer-events-none" />

                <section aria-labelledby="hero-title" className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 pb-14 sm:pb-20">
                  <div className="grid lg:grid-cols-[1.05fr_.95fr] items-center gap-12 lg:gap-16">
                    <div className="reveal-up max-w-3xl">
                      <h1 id="hero-title" className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.035em] text-white leading-[1.08]">
                        See a problem in your area?<br />
                        <span className="text-sky-400">
                          Report it here.
                        </span>
                      </h1>
                      
                      <p className="mt-6 text-base sm:text-lg leading-7 sm:leading-8 text-slate-300 max-w-2xl font-normal">
                        Take a photo, share the location, and track what happens next. You do not need an account.
                      </p>

                      <div className="mt-8 flex flex-col sm:flex-row gap-3.5">
                        <button 
                          onClick={() => { setReportStep(1); setActiveTab('report'); }} 
                          className="group w-full sm:w-auto h-12 px-7 rounded-lg font-bold bg-sky-400 hover:bg-sky-300 text-slate-950 transition-colors flex items-center justify-center gap-2.5 text-sm cursor-pointer"
                        >
                          <Icon name="camera" className="w-5 h-5 text-slate-950 stroke-[2.5]" />
                          <span>Report an Issue</span>
                          <Icon name="arrow-right" className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </button>
                        <button 
                          onClick={() => { setSelectedReport(null); setTrackingError(''); setActiveTab('track'); }}
                          className="w-full sm:w-auto h-12 px-7 rounded-lg font-semibold border border-slate-700 hover:border-slate-500 text-slate-200 hover:text-white transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                          <Icon name="search" className="w-4 h-4 text-sky-400" />
                          <span>Track a Report</span>
                        </button>
                      </div>

                      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
                        {['No account needed', 'Get a report ID', 'See proof when fixed'].map(item => (
                          <span key={item} className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                              <Icon name="check" className="w-2.5 h-2.5 text-emerald-400" />
                            </div>
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="reveal-up-delay relative max-w-xl lg:ml-auto w-full">
                      <div className="relative rounded-2xl glass-panel border border-slate-700/80 p-6 sm:p-7">
                        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                          <div className="text-sm font-semibold text-white">A public report</div>
                          <span className="text-xs text-slate-400">{featuredReport?.data_label === 'Demo' ? 'Example' : 'Recent'}</span>
                        </div>
                        {featuredReport && (
                          <div className="py-5">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <h2 className="text-base font-semibold text-white">{featuredReport.title}</h2>
                                <p className="mt-1 text-sm text-slate-400">{featuredReport.location}</p>
                              </div>
                              <span className="shrink-0 rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300">{featuredReport.status}</span>
                            </div>
                          </div>
                        )}

                        <button 
                          onClick={() => setActiveTab('map')} 
                          className="w-full min-h-12 rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-800/80 hover:border-sky-500/40 text-xs sm:text-sm font-semibold text-slate-200 transition-all flex items-center justify-center gap-2 shadow-sm"
                        >
                          <Icon name="map-pin" className="w-4 h-4 text-sky-400" />
                          <span>View public reports</span>
                        </button>
                      </div>
                    </div>
                  </div>

                </section>

                {/* 4-STEP ACCOUNTABLE PIPELINE SECTION */}
                <section aria-labelledby="workflow-title" className="relative border-t border-slate-800/80 bg-slate-950/40 py-14 sm:py-20">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="max-w-2xl mb-10">
                      <div className="text-xs text-sky-400 font-semibold uppercase">How it works</div>
                      <h2 id="workflow-title" className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-white">
                        Report. Track. Verify.
                      </h2>
                      <p className="mt-3 text-sm sm:text-base leading-relaxed text-slate-400">
                        A simple process, with a clear record at every step.
                      </p>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-5">
                      {[
                        { step: '01', title: 'Report', desc: 'Take or upload a photo, add the location, and briefly describe the problem.' },
                        { step: '02', title: 'Track', desc: 'Save your report ID and check progress whenever you need to.' },
                        { step: '03', title: 'Verify', desc: 'See the repair evidence and whether the resolution has been confirmed.' }
                      ].map((item) => (
                        <article key={item.step} className="border-t border-slate-700 pt-5 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-mono font-bold text-sky-400">{item.step}</span>
                            </div>
                            <h3 className="mt-5 text-base font-bold text-white">{item.title}</h3>
                            <p className="mt-2 text-xs sm:text-sm text-slate-400 leading-relaxed">{item.desc}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* 2. CITIZEN REPORT FLOW */}
            {activeTab === 'report' && (
              <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
                {/* STEPPER HEADER */}
                <div className="mb-8 border-b border-slate-800 pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Report a Civic Problem</h1>
                    <p className="text-sm text-slate-400 mt-1">Add a photo, location, and a short description.</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    {[
                      { step: 1, label: 'Photo' },
                      { step: 2, label: 'Details' },
                      { step: 3, label: 'Done' }
                    ].map((s, idx) => (
                      <React.Fragment key={s.step}>
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all ${
                          reportStep === s.step 
                            ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-bold'
                            : reportStep > s.step 
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold' 
                            : 'bg-slate-900/60 border-slate-800 text-slate-500'
                        }`}>
                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-slate-950 font-mono">
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
                  <div className="glass-panel border border-slate-800 rounded-2xl p-5 sm:p-8 text-center reveal-up">
                    <div className="border-2 border-dashed border-slate-700 hover:border-sky-500 rounded-xl p-8 sm:p-12 transition-colors flex flex-col items-center justify-center space-y-5">
                      <Icon name="camera" className="w-10 h-10 text-sky-400" />
                      <div className="max-w-md">
                        <h3 className="text-xl font-bold text-white tracking-tight">Add a photo of the problem</h3>
                        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                          A clear photo helps the responsible team understand what needs fixing.
                        </p>
                      </div>
                      
                      <div className="flex flex-col items-center gap-3 w-full sm:w-auto">
                        <label className="cursor-pointer w-full sm:w-auto px-8 py-3.5 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold text-sm transition-colors flex items-center justify-center gap-2">
                          <Icon name="upload-cloud" className="w-4 h-4 text-slate-950" />
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
                          className="text-xs text-slate-400 hover:text-sky-400 underline underline-offset-4 transition-colors"
                        >
                          I cannot add a photo
                        </button>
                      </div>

                      <div className="text-xs text-slate-500 pt-2">
                        JPEG, PNG or WebP · Up to 4 MB
                      </div>
                    </div>

                  </div>
                )}

                {/* STEP 2: REPORT DETAILS */}
                {reportStep === 2 && (
                  <div className="glass-panel border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-7 shadow-2xl reveal-up">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                      {/* EVIDENCE PREVIEW / SCANNER */}
                      <div>
                        <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-2">
                          <span>Photo preview</span>
                          {uploadedImage && <span className="text-emerald-400">● Usable photo</span>}
                        </div>
                        {uploadedImage ? (
                          <div className="ai-laser-container relative w-full h-64 rounded-2xl overflow-hidden border border-slate-700/80 bg-slate-950">
                            <img src={uploadedImage} alt="Report preview" className="w-full h-full object-cover" />
                            {isAnalyzing && (
                              <>
                                <div className="ai-laser-beam"></div>
                                <div className="ai-laser-grid"></div>
                                <div className="absolute bottom-3 inset-x-3 z-30 bg-slate-950/90 backdrop-blur-md border border-sky-500/40 rounded-xl p-2.5 text-center shadow-lg">
                                  <div className="text-xs font-bold text-sky-300 flex items-center justify-center gap-2">
                                    <Icon name="scan" className="w-4 h-4 text-sky-400 animate-spin" />
                                    Checking photo…
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-64 rounded-2xl border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-xs text-slate-500 bg-slate-950/40 p-6 text-center">
                            <Icon name="image-off" className="w-8 h-8 text-slate-600 mb-2" />
                            <span>No photo supplied</span>
                            <span className="text-[10px] text-slate-600 mt-1">Incident will be logged for authority inspection</span>
                          </div>
                        )}
                      </div>

                      {/* AI ASSESSMENT SIGNALS */}
                      <div className="flex flex-col justify-between space-y-4">
                        {isAnalyzing ? (
                          <div className="h-64 flex flex-col items-center justify-center space-y-4 py-8 glass-card rounded-2xl border border-sky-500/20">
                            <Icon name="scan" className="w-8 h-8 text-sky-400 animate-spin" />
                            <div className="text-center px-4">
                              <div className="text-sm font-bold text-white">Checking your photo</div>
                              <div className="text-xs text-slate-400 mt-1">We are identifying the type of problem.</div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3.5">
                            <div className="border-b border-slate-800 pb-4">
                              <div className="text-xs text-sky-400 font-semibold">Suggested description</div>
                              <p className="text-xs sm:text-sm font-medium text-slate-100 mt-1.5 leading-snug">
                                {aiAnalysis?.summary || 'Your photo is ready. Add the location and a short description below.'}
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-xs text-slate-400 block">Issue type</span>
                                <span className="text-white font-bold truncate block mt-0.5">{aiAnalysis?.category || reportForm.category}</span>
                              </div>
                              <div>
                                <span className="text-xs text-slate-400 block">Urgency</span>
                                <span className={`font-bold block mt-0.5 ${
                                  (aiAnalysis?.severity || reportForm.severity) === 'Critical' ? 'text-red-400' : 'text-amber-400'
                                }`}>
                                  {aiAnalysis?.severity || reportForm.severity}
                                </span>
                              </div>
                            </div>

                            {aiAnalysis?.is_civic_issue === false && (
                              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2">
                                <Icon name="alert-triangle" className="w-4 h-4 text-red-400 shrink-0" />
                                <span>This photo does not appear to show a valid public civic problem.</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {analysisComplete && (
                      <div className="border-t border-slate-800/80 pt-6 space-y-5">
                        {/* PHOTO LOCATION DETECTED BANNER */}
                        {photoLocation && (aiAnalysis?.is_civic_issue !== false || aiAnalysis?.confidence < 0.75) && (
                          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
                            <div>
                              <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5 font-mono">
                                <Icon name="map-pin" className="w-4 h-4 text-emerald-400" />
                                Location found in photo
                              </div>
                              <div className="text-[11px] text-slate-300 mt-1 font-mono">
                                {photoLocation.latitude.toFixed(5)}, {photoLocation.longitude.toFixed(5)}
                                {photoLocation.captured_at ? ` · Captured ${new Date(photoLocation.captured_at).toLocaleTimeString()}` : ''}
                              </div>
                            </div>
                            <button 
                              type="button" 
                              onClick={usePhotoLocation} 
                              className="shrink-0 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-all shadow-md"
                            >
                              Use this location
                            </button>
                          </div>
                        )}

                        {/* LOCATION PICKER & ADDRESS INPUT */}
                        <div>
                          <label className="block text-xs font-mono text-slate-400 mb-1.5 font-semibold">
                            Where is the problem? <span className="text-sky-400">*</span>
                          </label>
                          <div className="flex items-center gap-2 glass-input rounded-xl px-3.5 py-2.5 text-sm">
                            <Icon name="map-pin" className="w-4 h-4 text-sky-400 shrink-0" />
                            <input 
                              type="text" 
                              value={reportForm.location}
                              placeholder="Enter street, area or landmark"
                              onChange={(e) => setReportForm({...reportForm, location: e.target.value, locationSource: reportForm.latitude == null ? 'manual' : reportForm.locationSource, locationConfirmed: true})}
                              className="bg-transparent text-white focus:outline-none w-full text-xs sm:text-sm"
                            />
                            <button 
                              type="button" 
                              onClick={captureLocation} 
                              className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all ${
                                reportForm.locationSource === 'device_gps' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-sky-500/15 text-sky-400 border border-sky-500/30 hover:bg-sky-500/25'
                              }`}
                            >
                              {reportForm.locationSource === 'device_gps' ? '✓ Location added' : 'Use my location'}
                            </button>
                          </div>

                          <div className="flex items-center justify-between mt-2">
                            <button 
                              type="button" 
                              onClick={() => setShowLocationMap(value => !value)} 
                              className="text-xs text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1 transition-colors"
                            >
                              <Icon name={showLocationMap ? 'chevron-up' : 'map'} className="w-3.5 h-3.5" />
                              {showLocationMap ? 'Hide map' : 'Choose on map'}
                            </button>
                            {reportForm.locationSource && (
                              <span className="text-[10px] font-mono text-emerald-400">
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
                          <label className="block text-xs font-mono text-slate-400 mb-1.5 font-semibold">
                            Phone or email <span className="font-normal">(optional)</span>
                          </label>
                          <input 
                            type="text" 
                            value={reportForm.reporterContact} 
                            onChange={e => setReportForm({...reportForm, reporterContact: e.target.value})} 
                            placeholder="For updates about this report"
                            className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm focus:outline-none" 
                          />
                        </div>

                        {/* DESCRIPTION */}
                        <div>
                          <label className="block text-xs font-mono text-slate-400 mb-1.5 font-semibold">
                            What happened? <span className="text-sky-400">*</span>
                          </label>
                          <textarea 
                            rows={3}
                            value={reportForm.description}
                            onChange={(e) => setReportForm({...reportForm, description: e.target.value})}
                            placeholder="Briefly describe the problem"
                            className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm focus:outline-none"
                          />
                        </div>

                        {/* ACTION BUTTONS */}
                        <div className="flex items-center justify-between pt-3">
                          <button 
                            onClick={() => setReportStep(1)} 
                            className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                          >
                            ← Change photo
                          </button>
                          <button 
                            onClick={handleFinalSubmit}
                            disabled={isSubmitting || (aiAnalysis?.is_civic_issue === false && aiAnalysis?.confidence >= 0.75)}
                            className="px-7 py-3.5 rounded-lg text-sm font-bold bg-sky-400 hover:bg-sky-300 disabled:opacity-50 text-slate-950 flex items-center gap-2 transition-colors"
                          >
                            {isSubmitting ? (
                              <>
                                <Icon name="refresh-cw" className="w-4 h-4 animate-spin text-slate-950" />
                                <span>Submitting…</span>
                              </>
                            ) : (
                              <>
                                <span>Submit report</span>
                                <Icon name="arrow-right" className="w-4 h-4 text-slate-950" />
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
                <section aria-labelledby="report-success-title" className="glass-panel border border-emerald-500/30 rounded-2xl p-6 sm:p-8 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                    <Icon name="check" className="h-6 w-6" />
                  </div>
                  <h1 id="report-success-title" className="mt-5 text-2xl font-bold text-white">Report submitted</h1>
                  <p className="mt-2 text-sm text-slate-400">Save this report ID. You can use it to check progress anytime.</p>
                  <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950 px-4 py-5">
                    <div className="text-xs text-slate-400">Your report ID</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-sky-400">{submittedReportId}</div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button onClick={() => { navigator.clipboard?.writeText(submittedReportId); showToast('Report ID copied.'); }} className="min-h-12 rounded-lg border border-slate-700 px-5 text-sm font-semibold text-slate-200 hover:border-slate-500">Copy report ID</button>
                    <button onClick={() => setSubmittedReportId('')} className="min-h-12 rounded-lg bg-sky-400 px-5 text-sm font-bold text-slate-950 hover:bg-sky-300">Track this report</button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'track' && !submittedReportId && !selectedReport && (
              <div className="max-w-xl mx-auto px-4 py-16">
                <div className="rounded-2xl glass-panel border border-slate-800 p-6 sm:p-8 space-y-4 reveal-up">
                  <h1 className="text-2xl font-bold text-white tracking-tight">Track a Report</h1>
                  <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
                    Enter your report ID to see its current status and latest update.
                  </p>
                  <label htmlFor="tracking-id" className="block text-sm font-semibold text-slate-200">Report ID</label>
                  <div className="flex flex-col sm:flex-row gap-2.5 mt-2">
                    <input 
                      id="tracking-id"
                      value={trackingQuery} 
                      onChange={e => setTrackingQuery(e.target.value)} 
                      onKeyDown={e => e.key === 'Enter' && trackById()} 
                      placeholder="CP-ABC123 or ABC123"
                      className="flex-1 glass-input rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none"
                    />
                    <button 
                      onClick={trackById} 
                      disabled={trackingBusy}
                      className="px-6 py-3 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold text-sm transition-colors"
                    >
                      {trackingBusy ? 'Finding…' : 'Track'}
                    </button>
                  </div>
                  {trackingError && <div role="alert" className="text-xs text-red-300 rounded-xl border border-red-500/30 bg-red-500/10 p-3">{trackingError}</div>}
                  <button onClick={openJudgeDemo} className="text-sm font-semibold text-sky-300 hover:text-sky-200 inline-flex items-center gap-1.5">
                    See public report
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'track' && !submittedReportId && selectedReport && (
              <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 space-y-8 reveal-up">
                {/* INCIDENT HEADER CARD */}
                <div className="glass-panel border border-slate-800/80 rounded-3xl p-6 sm:p-7 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-2xl">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-2xl font-bold font-mono text-sky-400">
                        {selectedReport.id}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                        selectedReport.status === 'Resolved' 
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' 
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/40'
                      }`}>
                        {selectedReport.status}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono border ${
                        selectedReport.severity === 'Critical' ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}>
                        {selectedReport.severity}
                      </span>
                    </div>

                    <h1 className="text-xl font-bold text-white mt-2 tracking-tight">{selectedReport.title}</h1>
                    <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-1 font-sans">
                      <Icon name="map-pin" className="w-3.5 h-3.5 text-sky-400 shrink-0" />
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
                        className="glass-input rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none w-36" 
                      />
                      <button 
                        onClick={trackById} 
                        className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition-all shadow-md"
                      >
                        Track
                      </button>
                    </div>
                    <select 
                      value={selectedReport.id}
                      onChange={(e) => setSelectedReport(reports.find(r => r.id === e.target.value))}
                      className="glass-input rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none cursor-pointer"
                    >
                      {reports.map(r => (
                        <option key={r.id} value={r.id} className="bg-slate-900 text-white">{r.id} · {r.category}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2-COLUMN TIMELINE & EVIDENCE VERIFICATION WORKSPACE */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
                  {/* TIMELINE COLUMN */}
                  <div className="glass-panel border border-slate-800 rounded-3xl p-6 sm:p-7 space-y-6 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <h2 className="text-xs font-bold text-sky-400 uppercase tracking-widest font-mono flex items-center gap-2">
                        <Icon name="clock" className="w-4 h-4 text-sky-400" />
                        Report progress
                      </h2>
                    </div>
                    
                    <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2.5 before:bottom-2.5 before:w-0.5 before:bg-slate-800">
                      {selectedReport.timeline.map((item, idx) => (
                        <div key={idx} className="relative">
                          <div className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full border-2 transition-all ${
                            item.done ? 'bg-sky-400 border-slate-950' : 'bg-slate-950 border-slate-700'
                          }`} />
                          <div className="text-xs font-bold text-slate-100">{item.step}</div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">{item.time}</div>
                          {item.note && <div className="text-[10px] text-slate-500 mt-1 leading-snug">{item.note}</div>}
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-slate-800/80 pt-4 space-y-3">
                      <div className="text-xs text-slate-400">Responsible team</div>
                      <div className="glass-card p-3 rounded-xl text-xs font-semibold text-slate-200 flex items-center gap-2 border border-slate-800">
                        <Icon name="building-2" className="w-4 h-4 text-sky-400" />
                        <span>{selectedReport.department}</span>
                      </div>
                      {selectedReport.priority_score != null && (
                        <details className="rounded-xl border border-slate-800 p-3">
                          <summary className="cursor-pointer text-xs font-semibold text-slate-300">Why this priority?</summary>
                          <div className="flex items-center justify-between text-xs">
                            <span className="mt-2 font-bold text-slate-200">Priority</span>
                            <span className="font-mono font-extrabold text-sky-300">{selectedReport.priority_score}/100</span>
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">Based on urgency, how many people reported it, how long it has waited, and location safety.</p>
                        </details>
                      )}
                    </div>
                  </div>

                  {/* EVIDENCE & VERIFICATION COLUMN */}
                  <div className="lg:col-span-2 glass-panel border border-slate-800 rounded-3xl p-6 sm:p-7 space-y-6 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <h2 className="text-xs font-bold text-sky-400 uppercase tracking-widest font-mono flex items-center gap-2">
                        <Icon name="shield-check" className="w-4 h-4 text-sky-400" />
                        RESOLUTION & EVIDENCE
                      </h2>
                      {selectedReport.afterImage && (
                        <span className="text-xs text-emerald-400 font-mono bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30 font-bold flex items-center gap-1">
                          <span>✓</span> After Photo Verified
                        </span>
                      )}
                    </div>

                    {/* TWO-PARTY VERIFICATION */}
                    <div>
                      <div className="text-[11px] font-mono text-slate-400 mb-2 font-semibold">RESOLUTION VERIFICATION</div>
                      <div className="grid grid-cols-2 gap-2.5">
                        {[
                          ['contractor', 'Contractor Sign-off', 'hard-hat'],
                          ['government', 'Authority Inspector', 'landmark']
                        ].map(([key, label, icon]) => {
                          const approved = selectedReport.resolution_approvals?.[key];
                          const canApprove = authUser?.role === 'admin';
                          return (
                            <button 
                              key={key} 
                              disabled={!canApprove || approved} 
                              onClick={() => canApprove && !approved && approveResolution(selectedReport, key)} 
                              title={canApprove ? 'Record verified approval' : 'Authority approval required'}
                              className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all text-center ${
                                approved 
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-glow-emerald' 
                                  : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              <Icon name={icon} className={`w-4 h-4 ${approved ? 'text-emerald-400' : 'text-slate-500'}`} />
                              <span className="text-[11px] font-bold tracking-tight">{label}</span>
                              <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${approved ? 'bg-emerald-500/20 text-emerald-400 font-bold' : 'text-slate-600 bg-slate-900'}`}>
                                {approved ? '✓ VERIFIED' : 'PENDING'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>


                    {/* CONTRACTOR STAR RATING */}
                    {selectedReport.afterImage && selectedReport.assigned_contractor_id && (authUser?.role === 'admin' || sessionStorage.getItem(`urbanfix-reporter-${selectedReport.id}`)) && (
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Icon name="star" className="w-3.5 h-3.5 text-amber-400" />
                            Rate Contractor Performance
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">Rate quality, speed, and clean-up execution</p>
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
                    {selectedReport.afterImage ? (
                      <div className="relative h-80 sm:h-96 w-full rounded-2xl overflow-hidden select-none border border-slate-700/80 shadow-2xl bg-slate-950">
                        {/* AFTER IMAGE (BOTTOM) */}
                        <img src={selectedReport.afterImage} alt="After resolution" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute top-3.5 right-3.5 bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 text-[10px] font-mono px-3 py-1 rounded-full backdrop-blur-md font-bold shadow-lg">
                          AFTER RESOLUTION
                        </div>

                        {/* BEFORE IMAGE (TOP CLIPPED) */}
                        <div 
                          className="absolute inset-0 overflow-hidden"
                          style={{ width: `${sliderPos}%` }}
                        >
                          <img 
                            src={selectedReport.beforeImage} 
                            alt="Before report" 
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
                    ) : (
                      <div className="h-72 sm:h-80 w-full rounded-2xl overflow-hidden relative border border-slate-800 shadow-xl bg-slate-950">
                        <img src={selectedReport.beforeImage} alt="Reported problem" className="w-full h-full object-cover" />
                        <div className="absolute bottom-3.5 inset-x-3.5 bg-slate-950/85 text-slate-300 border border-slate-800 text-xs p-3 rounded-xl backdrop-blur-md flex items-center gap-2">
                          <Icon name="clock" className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Resolution in progress. Inspection proof photo will appear here when completed.</span>
                        </div>
                      </div>
                    )}

                    {selectedReport.resolution_evidence?.report_url && (
                      <a href={selectedReport.resolution_evidence.report_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold text-sky-300 hover:border-sky-500/50">
                        <span className="flex items-center gap-2"><Icon name="file-text" className="w-4 h-4" />View contractor work report</span>
                        <Icon name="external-link" className="w-4 h-4" />
                      </a>
                    )}

                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans glass-card p-4 rounded-2xl border border-slate-800">
                      {selectedReport.description}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-4">
                      <div className="text-xs text-slate-400">
                        <span className="text-white font-bold">{selectedReport.affected_count || 1}</span> citizens affected · <span className="text-white font-bold">{selectedReport.duplicates || 1}</span> linked incident reports
                      </div>
                      <button 
                        onClick={markAffected} 
                        className="px-4 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 text-xs font-bold transition-all flex items-center gap-1.5"
                      >
                        <Icon name="thumbs-up" className="w-3.5 h-3.5 text-sky-400" />
                        <span>I’m Affected Too (+1)</span>
                      </button>
                    </div>

                    <button 
                      onClick={() => loadAccountabilityReceipt(selectedReport)} 
                      className="w-full py-3 rounded-xl glass-card border border-slate-700 hover:border-sky-500/50 text-xs font-semibold text-sky-400 transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Icon name="file-text" className="w-4 h-4 text-sky-400" />
                      <span>View accountability receipt</span>
                    </button>
                  </div>
                </div>

                {/* ACCOUNTABILITY RECEIPT DISPLAY */}
                {accountabilityReceipt && accountabilityReceipt.complaint_id === selectedReport.id && (
                  <section aria-label="Public accountability receipt" className="rounded-3xl glass-panel border border-sky-500/40 p-6 sm:p-8 space-y-5 shadow-2xl reveal-up">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
                      <div>
                        <div className="text-[10px] font-mono text-sky-400 font-bold tracking-widest uppercase">ACCOUNTABILITY RECEIPT</div>
                        <h2 className="text-xl font-extrabold text-white mt-1">{accountabilityReceipt.incident_id || accountabilityReceipt.complaint_id}</h2>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-2xl glass-card p-4 border border-slate-800">
                        <div className="text-slate-400 font-mono text-[10px]">AI CLASSIFICATION</div>
                        <div className="text-white font-bold mt-1">{accountabilityReceipt.ai_assessment.category}</div>
                        <div className="text-[11px] text-sky-400 mt-0.5">{Math.round((accountabilityReceipt.ai_assessment.confidence || 0)*100)}% Confidence</div>
                      </div>
                      <div className="rounded-2xl glass-card p-4 border border-slate-800">
                        <div className="text-slate-400 font-mono text-[10px]">PRIORITY SCORE</div>
                        <div className="text-white font-bold mt-1 text-lg font-mono">{accountabilityReceipt.priority.score}/100</div>
                      </div>
                      <div className="rounded-2xl glass-card p-4 border border-slate-800">
                        <div className="text-slate-400 font-mono text-[10px]">LINKED REPORTS</div>
                        <div className="text-white font-bold mt-1 text-lg font-mono">{accountabilityReceipt.incident_report_count}</div>
                      </div>
                      <div className="rounded-2xl glass-card p-4 border border-slate-800">
                        <div className="text-slate-400 font-mono text-[10px]">STATUS</div>
                        <div className={`font-bold mt-1 ${accountabilityReceipt.resolution.fully_verified ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {accountabilityReceipt.resolution.fully_verified ? 'Verified (2/2)' : 'Awaiting Approval'}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed font-sans">
                      {accountabilityReceipt.priority.methodology}
                    </p>
                  </section>
                )}
              </div>
            )}

            {/* 4. PUBLIC CIVIC MAP */}
            {activeTab === 'map' && (
              <div className="max-w-7xl mx-auto px-4 py-8 sm:py-10 space-y-6 reveal-up">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel border border-slate-800 p-5 sm:p-6 rounded-3xl shadow-xl">
                  <div>
                    <div className="text-xs text-sky-400 font-semibold uppercase">Public reports</div>
                    <h1 className="text-xl sm:text-2xl font-bold text-white mt-1 tracking-tight">Issues near you</h1>
                    <p className="text-sm text-slate-400 mt-1">Select a marker to see the problem and its current status.</p>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {['All', 'Roads', 'Sanitation', 'Water'].map((f) => {
                      const count = reports.filter(rep => f === 'All' || (f === 'Roads' && /road/i.test(rep.category)) || (f === 'Sanitation' && /waste|sanitation/i.test(rep.category)) || (f === 'Water' && /water|drain|sewer/i.test(rep.category))).length;
                      return (
                        <button 
                          onClick={() => setMapFilter(f)} 
                          key={f} 
                          className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                            mapFilter === f 
                              ? 'bg-sky-500 text-slate-950 shadow-glow-sky' 
                              : 'glass-card text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <span>{f}</span>
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${mapFilter === f ? 'bg-slate-950 text-sky-300' : 'bg-slate-900 text-slate-400'}`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="glass-panel border border-slate-800/80 rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4">
                  <AuthorityMap
                    reports={reports.filter(rep => mapFilter === 'All' || (mapFilter === 'Roads' && /road/i.test(rep.category)) || (mapFilter === 'Sanitation' && /waste|sanitation/i.test(rep.category)) || (mapFilter === 'Water' && /water|drain|sewer/i.test(rep.category)))}
                    onSelect={report => { setSelectedReport(report); setActiveTab('track'); }}
                    useClusters={reportsTruncated}
                  />
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2 text-[11px] font-mono">
                    <div className="glass-card p-2.5 rounded-xl border border-slate-800 flex items-center gap-2 text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-glow-emerald" /> 
                      <span>Contractor + authority verified</span>
                    </div>
                    <div className="glass-card p-2.5 rounded-xl border border-slate-800 flex items-center gap-2 text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-glow-sky" /> 
                      <span>Partly Approved / Progress</span>
                    </div>
                    <div className="glass-card p-2.5 rounded-xl border border-slate-800 flex items-center gap-2 text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> 
                      <span>Moderate Priority</span>
                    </div>
                    <div className="glass-card p-2.5 rounded-xl border border-slate-800 flex items-center gap-2 text-slate-300">
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
                <div className="glass-panel border border-slate-800 p-6 sm:p-7 rounded-3xl shadow-xl">
                  <div className="text-[10px] font-mono tracking-widest text-sky-400 font-bold uppercase">SUPERVISED COMMUNITY ACTION</div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1 tracking-tight">Propose Low-Risk Micro-Maintenance</h1>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
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
                  <div className="glass-panel border border-slate-800 rounded-3xl p-8 text-center space-y-4">
                    <p className="text-sm text-slate-300">The current active account is not registered as a youth worker.</p>
                    <button onClick={logout} className="px-5 py-2.5 rounded-xl glass-card border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white">
                      Log out
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-4 glass-panel border border-sky-500/30 bg-sky-950/20 rounded-2xl p-4 sm:p-5">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{authUser.name}</span>
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-300 font-bold">
                            VERIFIED CITIZEN
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 font-mono">{authUser.email} · Proposals & proof linked to escrow balance</div>
                      </div>
                      <button onClick={logout} className="px-4 py-2 rounded-xl glass-card border border-slate-700 hover:border-slate-600 text-xs font-semibold text-slate-300">
                        Log out
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 text-center text-xs font-mono">
                      <div className="rounded-2xl glass-card p-3 border border-slate-800">
                        <span className="text-sky-400 font-bold block text-sm">01</span> Submit Plan & Estimate
                      </div>
                      <div className="rounded-2xl glass-card p-3 border border-slate-800">
                        <span className="text-amber-400 font-bold block text-sm">02</span> Authority Escrow Lock
                      </div>
                      <div className="rounded-2xl glass-card p-3 border border-slate-800">
                        <span className="text-emerald-400 font-bold block text-sm">03</span> After Photo & Payout
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      {/* PROPOSAL FORM */}
                      <div className="glass-panel border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Submit New Proposal</h2>
                        <select 
                          value={repairForm.complaint_id} 
                          onChange={e => setRepairForm({...repairForm, complaint_id: e.target.value})} 
                          className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white"
                        >
                          <option value="" className="bg-slate-900">Select an eligible low-risk task</option>
                          {reports.filter(r => r.status !== 'Resolved' && r.volunteer_eligible === true).map(r => (
                            <option key={r.id} value={r.id} className="bg-slate-900">{r.id} · {r.category} · {r.location}</option>
                          ))}
                        </select>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <input 
                            type="number" 
                            min="1" 
                            value={repairForm.estimated_price} 
                            onChange={e => setRepairForm({...repairForm, estimated_price: e.target.value})} 
                            placeholder="Estimate (PKR)" 
                            className="min-w-0 glass-input rounded-xl p-3 text-xs sm:text-sm text-white"
                          />
                          <input 
                            type="number" 
                            min="1" 
                            value={repairForm.estimated_hours} 
                            onChange={e => setRepairForm({...repairForm, estimated_hours: e.target.value})} 
                            placeholder="Hours required" 
                            className="min-w-0 glass-input rounded-xl p-3 text-xs sm:text-sm text-white"
                          />
                        </div>
                        <textarea 
                          rows="4" 
                          value={repairForm.plan} 
                          onChange={e => setRepairForm({...repairForm, plan: e.target.value})} 
                          placeholder="Detail materials needed, safe tools, clean-up steps, and expected completion result..." 
                          className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white"
                        />
                        <button 
                          onClick={submitRepairRequest} 
                          disabled={!repairForm.complaint_id || repairForm.plan.length < 10 || !repairForm.estimated_price} 
                          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-40 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 transition-all"
                        >
                          Send Proposal to Authority
                        </button>
                      </div>

                      {/* PROPOSAL HISTORY */}
                      <div className="space-y-3.5">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Your Proposal Ledger</h2>
                        {repairRequests.length ? repairRequests.slice().reverse().map(req => (
                          <div key={req.request_id} className="glass-card border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-3">
                            <div className="flex justify-between gap-3">
                              <div>
                                <div className="font-mono text-sky-400 text-xs font-bold">{req.request_id} · {req.complaint_id}</div>
                                <div className="text-sm font-bold text-white mt-0.5">{req.issue_title || req.applicant_name}</div>
                              </div>
                              <span className="text-[10px] text-amber-400 font-mono font-bold bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full h-fit">
                                {req.status}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 font-mono">
                              Budget: PKR {Number(req.estimated_price).toLocaleString()} · {req.estimated_hours}h
                            </div>
                            {req.admin_note && (
                              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 text-xs text-slate-300">
                                <span className="text-slate-500 font-mono text-[10px] block">AUTHORITY NOTE</span> {req.admin_note}
                              </div>
                            )}
                            {req.status === 'Approved - Awaiting Work' && (
                              <label className="block cursor-pointer text-center text-xs px-4 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 transition-colors font-bold">
                                📷 Upload Required After-Repair Photo
                                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={e => submitProofFile(req, e.target.files?.[0])} />
                              </label>
                            )}
                            {req.proof && (
                              <div className="flex gap-3 items-center glass-panel p-2.5 rounded-xl border border-slate-800">
                                <img src={absoluteMediaUrl(req.proof.after_image_url)} alt="Your after-repair proof" className="w-16 h-14 object-cover rounded-lg border border-slate-700" />
                                <span className="text-xs text-emerald-400 font-semibold">After photo uploaded for authority release.</span>
                              </div>
                            )}
                          </div>
                        )) : (
                          <div className="glass-card border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
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
                  <div className="flex glass-panel border border-slate-800 rounded-2xl p-1">
                    <button onClick={() => setAuthMode('login')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${authMode === 'login' ? 'bg-sky-500 text-slate-950 shadow-md' : 'text-slate-400'}`}>Login</button>
                    <button onClick={() => setAuthMode('register')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${authMode === 'register' ? 'bg-sky-500 text-slate-950 shadow-md' : 'text-slate-400'}`}>Register</button>
                  </div>
                  <div className="glass-panel border border-slate-800 rounded-3xl p-6 sm:p-7 space-y-4 shadow-2xl">
                    <h1 className="text-xl font-extrabold text-white">Contractor Service Hub</h1>
                    {authMode === 'register' && (
                      <input value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} placeholder="Business or contractor name" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                    )}
                    <input type="email" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} placeholder="Contractor email" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                    {authMode === 'register' && (
                      <>
                        <input value={authForm.phone} onChange={e => setAuthForm({...authForm, phone: e.target.value})} placeholder="Phone number" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                        <input value={contractorForm.service_area} onChange={e => setContractorForm({...contractorForm, service_area: e.target.value})} placeholder="Service area (e.g. Zone 4)" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                        <input value={contractorForm.skills} onChange={e => setContractorForm({...contractorForm, skills: e.target.value})} placeholder="Skills (Roads, Asphalt, Plumbing, Electrical)" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                        <input value={contractorForm.payout_account_id} onChange={e => setContractorForm({...contractorForm, payout_account_id: e.target.value})} placeholder="Stripe Connect account (acct_…)" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                      </>
                    )}
                    <input type="password" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} placeholder="Password" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                    {authMode === 'register' && (
                      <input type="password" value={authForm.confirmPassword} onChange={e => setAuthForm({...authForm, confirmPassword: e.target.value})} placeholder="Confirm password" className="w-full glass-input rounded-xl p-3 text-xs sm:text-sm text-white" />
                    )}
                    {authError && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-xl">{authError}</div>}
                    <button onClick={authenticateContractor} disabled={authBusy} className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-40 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/20 transition-all">
                      {authBusy ? 'Authenticating…' : authMode === 'register' ? 'Submit Registration' : 'Contractor Sign In'}
                    </button>
                  </div>
                  {authUser && <button onClick={logout} className="block mx-auto text-xs text-slate-400 hover:text-white underline">Log out of current session</button>}
                </div>
              ) : (
                <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 space-y-7 reveal-up">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel border border-slate-800 p-6 rounded-3xl shadow-xl">
                    <div>
                      <div className="text-[10px] font-mono tracking-widest text-sky-400 font-bold uppercase">CONTRACTOR OPERATIONS PORTAL</div>
                      <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-1">{contractorProfile?.name || 'Contractor Hub'}</h1>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">Status: {contractorProfile?.approval_status || 'Approved'} · Rating: ★ {contractorProfile?.rating || '5.0'}</p>
                    </div>
                    <button onClick={logout} className="px-4 py-2 rounded-xl glass-card border border-slate-700 text-xs font-semibold text-slate-300">
                      Log out
                    </button>
                  </div>

                  <div className="space-y-4">
                    <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Assigned Work Orders</h2>
                    {contractorJobs.map(job => (
                      <div key={job.offer_id} className="glass-panel border border-slate-800/80 rounded-3xl p-6 space-y-3 shadow-xl">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-mono text-sky-400 font-bold">{job.offer_id} · {job.complaint_id}</div>
                            <h3 className="text-base font-bold text-white mt-0.5">{job.issue_title}</h3>
                            <p className="text-xs text-slate-400 mt-1 font-mono">{job.work_location_area} · Budget: PKR {Number(job.budget_cap).toLocaleString()} · SLA: {job.sla_hours}h</p>
                          </div>
                          <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full h-fit">
                            {job.status}
                          </span>
                        </div>
                        <div className="flex gap-2.5 pt-2">
                          {job.status === 'Sent' && (
                            <>
                              <button onClick={() => updateContractorJob(job, 'Rejected')} className="px-4 py-2 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs font-bold transition-colors">
                                Reject
                              </button>
                              <button onClick={() => updateContractorJob(job, 'Accepted')} className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-colors shadow-md">
                                Accept Order
                              </button>
                            </>
                          )}
                          {job.status === 'Accepted' && (
                            <button onClick={() => updateContractorJob(job, 'In Progress')} className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition-colors shadow-md">
                              Start Work On-Site
                            </button>
                          )}
                          {job.status === 'In Progress' && (
                            <div className="w-full grid gap-2 sm:grid-cols-2">
                              <label className="glass-input rounded-xl p-3 text-xs text-slate-300 cursor-pointer"><span>{contractorProofs[job.offer_id]?.image?.name || 'Choose completion photo'}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),image:e.target.files?.[0] || null}})} /></label>
                              <input type="url" value={contractorProofs[job.offer_id]?.report_url || ''} onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),report_url:e.target.value}})} placeholder="Public Google Drive report link" className="glass-input rounded-xl p-3 text-xs text-white" />
                              <textarea value={contractorProofs[job.offer_id]?.note || ''} onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),note:e.target.value}})} placeholder="Short completion summary" rows="2" className="sm:col-span-2 glass-input rounded-xl p-3 text-xs text-white resize-none" />
                              <label className="sm:col-span-2 flex items-start gap-2.5 rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300 cursor-pointer">
                                <input type="checkbox" checked={Boolean(contractorProofs[job.offer_id]?.public_access_confirmed)} onChange={e => setContractorProofs({...contractorProofs,[job.offer_id]:{...(contractorProofs[job.offer_id]||{}),public_access_confirmed:e.target.checked}})} className="mt-0.5 accent-sky-500" />
                                <span>I confirm the Google Drive report is set to <strong className="text-white">Anyone with the link can view</strong>.</span>
                              </label>
                              <button onClick={() => updateContractorJob(job, 'Proof Submitted')} className="sm:col-span-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold">Submit completed work for review</button>
                            </div>
                          )}
                          {job.status === 'Proof Submitted' && <p className="text-xs text-emerald-300">Completion proof submitted. Waiting for authority verification.</p>}
                        </div>
                      </div>
                    ))}
                    {!contractorJobs.length && (
                      <div className="glass-panel border border-slate-800 rounded-3xl p-12 text-center text-xs text-slate-400">
                        No active work orders currently assigned to your team.
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {/* 7. AUTHORITY COMMAND CENTER */}
            {activeTab === 'admin' && (
              authUser?.role !== 'admin' ? (
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
                  />
                  {authUser && (
                    <button onClick={logout} className="block mx-auto text-xs text-slate-400 hover:text-white underline">
                      Log out of {authUser.email} first
                    </button>
                  )}
                </div>
              ) : (
                <div className="max-w-7xl mx-auto px-4 py-8 sm:py-10 space-y-8 reveal-up">
                  {/* COMMAND HEADER */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel border border-slate-800 p-6 rounded-3xl shadow-xl">
                    <div>
                      <div className="text-xs text-sky-400 font-semibold">Municipal operations</div>
                      <h1 className="text-xl sm:text-2xl font-bold text-white mt-1 tracking-tight">Authority dashboard</h1>
                      <p className="text-sm text-slate-400 mt-1">Review priority cases, approve evidence, and manage assignments.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
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
                          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${adminView === id
                              ? 'bg-sky-500 text-slate-950 shadow-glow-sky'
                              : 'glass-card border border-slate-800 text-slate-300 hover:text-white'
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
                      <div key={idx} className={`glass-panel rounded-2xl p-5 border transition-all ${kpi.alert && kpi.val > 0 ? 'border-red-500/40 bg-red-950/15' : 'border-slate-800'}`}>
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="text-xs font-semibold">{kpi.label}</span>
                          <Icon name={kpi.icon} className={`w-4 h-4 ${kpi.alert && kpi.val > 0 ? 'text-red-400' : 'text-sky-400'}`} />
                        </div>
                        <div className={`text-3xl font-bold mt-2 tracking-tight ${kpi.alert && kpi.val > 0 ? 'text-red-400' : 'text-white'}`}>
                          {kpi.val}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* AI GOVERNANCE INSIGHT */}
                  {dashboard?.insight && (
                    <div className="glass-panel border border-sky-500/30 bg-sky-950/20 rounded-2xl p-5 flex items-start gap-3.5 shadow-lg">
                      <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                        <Icon name="sparkles" className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-sky-400">Suggested priority summary</div>
                        <p className="text-xs sm:text-sm text-slate-200 mt-1 leading-relaxed">{dashboard.insight}</p>
                      </div>
                    </div>
                  )}

                  {/* QUEUE FILTERS */}
                  {['queue', 'map', 'review', 'proofs'].includes(adminView) && (
                    <div className="glass-panel border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-semibold text-white">Find and filter cases</h2>
                          <p className="text-xs text-slate-400 mt-0.5">Showing {filteredAdminReports.length} of {reports.length} municipal incidents</p>
                        </div>
                        <button onClick={resetQueueFilters} className="text-xs text-sky-400 hover:text-sky-300 font-mono font-semibold underline underline-offset-4">
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
                          className="lg:col-span-2 glass-input rounded-xl px-3.5 py-2.5 text-xs text-white"
                        />
                        <select aria-label="Reported within" value={queueFilters.days} onChange={e => setQueueFilters({ ...queueFilters, days: e.target.value })} className="glass-input rounded-xl px-3 py-2.5 text-xs text-white">
                          <option value="all" className="bg-slate-900">Any age</option>
                          <option value="1" className="bg-slate-900">Last 24 hours</option>
                          <option value="7" className="bg-slate-900">Last 7 days</option>
                          <option value="15" className="bg-slate-900">Last 15 days</option>
                          <option value="30" className="bg-slate-900">Last 30 days</option>
                        </select>
                        <select aria-label="Work state" value={queueFilters.state} onChange={e => setQueueFilters({ ...queueFilters, state: e.target.value })} className="glass-input rounded-xl px-3 py-2.5 text-xs text-white">
                          <option value="all" className="bg-slate-900">All statuses</option>
                          <option value="needs_action" className="bg-slate-900">Needs action</option>
                          <option value="assigned" className="bg-slate-900">Assigned</option>
                          <option value="unresolved" className="bg-slate-900">Unresolved</option>
                          <option value="resolved" className="bg-slate-900">Resolved</option>
                        </select>
                        <select aria-label="Category" value={queueFilters.category} onChange={e => setQueueFilters({ ...queueFilters, category: e.target.value })} className="glass-input rounded-xl px-3 py-2.5 text-xs text-white">
                          <option value="all" className="bg-slate-900">All categories</option>
                          {reportCategories.map(category => <option key={category} value={category} className="bg-slate-900">{category}</option>)}
                        </select>
                        <select aria-label="Severity" value={queueFilters.severity} onChange={e => setQueueFilters({ ...queueFilters, severity: e.target.value })} className="glass-input rounded-xl px-3 py-2.5 text-xs text-white">
                          <option value="all" className="bg-slate-900">All severities</option>
                          {['Critical', 'High', 'Medium', 'Low'].map(level => <option key={level} value={level} className="bg-slate-900">{level}</option>)}
                        </select>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-slate-400">Sort by:</span>
                        {[
                          ['priority', 'Highest Priority'],
                          ['oldest', 'Oldest First'],
                          ['newest', 'Newest First']
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            onClick={() => setQueueFilters({ ...queueFilters, sort: value })}
                            className={`px-3 py-1 rounded-xl border text-[11px] font-bold transition-all ${queueFilters.sort === value ? 'border-sky-500/50 bg-sky-500/20 text-sky-300' : 'border-slate-800 text-slate-400 hover:text-white'
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
                    <div className="glass-panel border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4">
                      <div className="flex justify-between items-center">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Filtered Incident Telemetry Map</h2>
                        <span className="text-xs font-mono text-slate-400">{filteredAdminReports.filter(r => Number.isFinite(r.coordinates?.lat)).length} mapped coordinates</span>
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
                          <div key={label} className="glass-panel border border-slate-800 rounded-2xl p-5">
                            <div className="text-xs text-slate-400 font-mono">{label}</div>
                            <div className="text-3xl font-extrabold text-white font-mono mt-1">{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CONTRACTORS VIEW */}
                  {adminView === 'contractors' && (
                    <div className="space-y-3">
                      {contractors.map(contractor => (
                        <div key={contractor.contractor_id} className="glass-panel border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-mono text-sky-400 font-bold">{contractor.contractor_id}</div>
                            <div className="text-base font-bold text-white mt-0.5">{contractor.name}</div>
                            <div className="text-xs text-slate-400 mt-1 font-mono">
                              {contractor.service_area} · {(contractor.skills || []).join(', ') || 'General Works'} · {contractor.approval_status || (contractor.verified ? 'Approved' : 'Pending Verification')}
                            </div>
                          </div>
                          {!contractor.verified && (
                            <div className="flex gap-2">
                              <button onClick={() => approveContractor(contractor, false)} className="px-4 py-2 rounded-xl border border-red-500/30 text-red-400 text-xs font-bold">
                                Reject
                              </button>
                              <button onClick={() => approveContractor(contractor, true)} className="px-5 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold">
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
                      <div className="glass-panel border border-slate-800 rounded-3xl p-6">
                        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Community Repair Escrow Dispatch</h2>
                        <p className="text-xs text-slate-400 mt-1">Review applicant work plans, lock budget in escrow, inspect completion proof photos, and release funds.</p>
                      </div>
                      {repairRequests.length ? repairRequests.map(req => (
                        <div key={req.request_id} className="glass-panel border border-slate-800 rounded-3xl p-6 grid lg:grid-cols-[1fr_300px] gap-6 shadow-xl">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-mono text-sky-400 font-bold">{req.request_id}</span>
                              <span className="text-xs font-mono text-slate-400">Incident: {req.complaint_id}</span>
                              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[10px] font-mono text-amber-400 font-bold">{req.status}</span>
                            </div>
                            <div className="text-lg font-bold text-white mt-2">{req.applicant_name} · PKR {Number(req.estimated_price).toLocaleString()}</div>
                            <div className="text-xs text-slate-400 mt-0.5 font-mono">Contact: {req.applicant_contact} · Est. Hours: {req.estimated_hours}h</div>
                            <div className="mt-4 p-4 rounded-2xl bg-slate-950/80 border border-slate-800">
                              <div className="text-[10px] font-mono text-slate-400 mb-1 font-bold">SUBMITTED WORK PLAN</div>
                              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{req.plan}</p>
                            </div>
                            {req.proof && (
                              <div className="mt-4 flex items-center gap-3 glass-card p-3 rounded-2xl border border-slate-800">
                                <img src={absoluteMediaUrl(req.proof.after_image_url)} className="w-24 h-20 object-cover rounded-xl border border-slate-700" alt="Completion proof" />
                                <div>
                                  <div className="text-xs text-emerald-400 font-bold">Youth completion photo uploaded</div>
                                  <div className="text-xs text-slate-400 mt-1">{req.proof.completion_note}</div>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            <div className="rounded-2xl glass-card border border-slate-800 p-4">
                              <div className="text-[10px] font-mono text-slate-400 font-bold">ESCROW STATUS</div>
                              <div className="text-xs text-white mt-1">{req.funds_status}</div>
                              {req.approved_budget && <div className="text-xl font-extrabold text-emerald-400 font-mono mt-1">PKR {Number(req.approved_budget).toLocaleString()}</div>}
                            </div>
                            {req.status === 'Pending Admin Review' && (
                              <>
                                <label className="block text-xs text-slate-400 font-mono">Approved Escrow Amount
                                  <input type="number" value={fundingBudgets[req.request_id] ?? req.estimated_price} onChange={e => setFundingBudgets({ ...fundingBudgets, [req.request_id]: e.target.value })} className="mt-1 w-full glass-input rounded-xl p-2.5 text-xs text-white font-mono" />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <button onClick={() => decideRepair(req, false)} className="px-3 py-2 rounded-xl border border-red-500/30 text-red-400 text-xs font-bold">Reject</button>
                                  <button onClick={() => decideRepair(req, true)} className="px-3 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-bold shadow-md">Reserve Escrow</button>
                                </div>
                              </>
                            )}
                            {req.status === 'Approved - Awaiting Work' && (
                              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-3.5 text-xs text-amber-300 leading-snug">
                                Waiting for youth worker on-site execution and after photo upload.
                              </div>
                            )}
                            {req.status === 'Proof Submitted - Awaiting Verification' && (
                              <button onClick={() => releaseFunds(req)} className="w-full py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/25 transition-all">
                                ✓ Verify Proof & Release Funds
                              </button>
                            )}
                          </div>
                        </div>
                      )) : (
                        <div className="glass-panel border border-slate-800 rounded-3xl p-10 text-center text-xs text-slate-400">
                          No community funding requests currently awaiting review.
                        </div>
                      )}
                    </div>
                  )}

                  {/* WORK QUEUE VIEW */}
                  {['queue', 'review', 'proofs'].includes(adminView) && (
                    <div className="glass-panel border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
                      <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between">
                        <h2 className="text-xs font-bold text-white font-mono uppercase tracking-wider">{adminView === 'proofs' ? 'Contractor proof review' : adminView === 'review' ? 'Human review queue' : 'Municipal work queue'}</h2>
                        <span className="text-xs font-mono text-slate-400">{displayedAdminReports.length} shown</span>
                      </div>

                      {/* INCIDENT WORKSPACE DRAWER */}
                      {(operationLoading || operationDetail) && (
                        <div className="border-b border-slate-800 p-6 bg-slate-950/80 reveal-up">
                          {operationLoading ? (
                            <div className="text-xs text-slate-400 font-mono">Loading incident workspace…</div>
                          ) : (
                            <div className="space-y-5">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="text-xs font-mono text-sky-400 font-bold">INCIDENT WORKSPACE · {operationDetail.complaint.id}</div>
                                  <h3 className="text-lg font-bold text-white mt-0.5">{operationDetail.complaint.title}</h3>
                                  <p className="text-xs text-slate-400 mt-0.5 font-mono">{operationDetail.complaint.location}</p>
                                </div>
                                <button onClick={() => setOperationDetail(null)} className="text-slate-400 hover:text-white text-lg font-bold">×</button>
                              </div>

                              <div className="grid lg:grid-cols-[240px_1fr] gap-5">
                                {operationDetail.complaint.beforeImage ? (
                                  <img src={operationDetail.complaint.beforeImage} alt="Citizen evidence" className="w-full h-48 object-cover rounded-2xl border border-slate-800 shadow-md" />
                                ) : (
                                  <div className="h-48 rounded-2xl glass-card border border-slate-800 flex items-center justify-center text-xs text-slate-500">
                                    No photo evidence supplied
                                  </div>
                                )}
                                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                                  <div className="p-3.5 rounded-2xl glass-card border border-slate-800">
                                    <div className="text-slate-400 font-mono text-[10px] font-bold">CITIZEN INPUT</div>
                                    <p className="text-slate-200 mt-1.5 leading-relaxed">{operationDetail.complaint.description}</p>
                                  </div>
                                  <div className="p-3.5 rounded-2xl glass-card border border-slate-800">
                                    <div className="text-slate-400 font-mono text-[10px] font-bold">AI VISION ASSESSMENT</div>
                                    <div className="text-white font-bold mt-1.5">{operationDetail.complaint.category} · {operationDetail.complaint.severity}</div>
                                    <p className="text-slate-400 mt-1 text-[11px] leading-snug">{operationDetail.complaint.ai_reasoning || operationDetail.complaint.title}</p>
                                    <div className="text-sky-400 font-mono text-[11px] mt-1.5">Confidence: {operationDetail.complaint.confidence}</div>
                                  </div>
                                  <div className="sm:col-span-2 p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/25">
                                    <div className="text-sky-400 font-mono text-[10px] font-bold">RECOMMENDED NEXT ACTION</div>
                                    <p className="text-slate-200 mt-1 text-xs">{operationDetail.recommended_action}</p>
                                  </div>
                                </div>
                              </div>

                              <div className="grid lg:grid-cols-2 gap-5 pt-2">
                                <div>
                                  <div className="text-xs font-mono text-slate-400 mb-2 font-bold">MATCHED CONTRACTORS</div>
                                  <div className="flex gap-2">
                                    <select value={offerForm.contractor_id} onChange={e => setOfferForm({ ...offerForm, contractor_id: e.target.value })} className="min-w-0 flex-1 glass-input rounded-xl p-2.5 text-xs text-white">
                                      {operationDetail.contractor_matches.map(c => <option key={c.contractor_id} value={c.contractor_id} className="bg-slate-900">{c.name} · {c.match_score}% Match · ★{c.rating}</option>)}
                                    </select>
                                    <input type="number" placeholder="Budget PKR" value={offerForm.budget_cap} onChange={e => setOfferForm({ ...offerForm, budget_cap: e.target.value })} className="w-28 glass-input rounded-xl p-2.5 text-xs text-white font-mono" />
                                    <button disabled={operationDetail.complaint.needs_review || operationDetail.offers.some(o => ['Sent','Accepted','In Progress','Proof Submitted','Approved'].includes(o.status))} onClick={assignContractor} className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-35 disabled:cursor-not-allowed text-slate-950 text-xs font-bold shadow-md">Dispatch Order</button>
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-mono text-slate-400 mb-2 font-bold">ACTIVE WORK ORDERS</div>
                                  {operationDetail.offers.length ? (
                                    <div className="space-y-2">
                                      {operationDetail.offers.map(offer => (
                                        <div key={offer.offer_id} className="glass-card p-3 rounded-xl border border-slate-800 text-xs">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                              <span className="text-white font-bold">{offer.contractor_name}</span>
                                              <span className="text-slate-400"> · PKR {Number(offer.budget_cap).toLocaleString()}</span>
                                            </div>
                                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${offer.status === 'Proof Submitted' ? 'bg-amber-500/15 text-amber-300' : offer.status === 'Approved' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-sky-500/10 text-sky-300'}`}>{offer.status}</span>
                                          </div>
                                          {offer.status === 'Proof Submitted' && (
                                            <div className="mt-3 grid sm:grid-cols-[88px_1fr] gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                                              {offer.after_image_url && <img src={absoluteMediaUrl(offer.after_image_url)} alt="Contractor completion evidence" className="h-20 w-full rounded-lg object-cover" />}
                                              <div className="space-y-2 min-w-0">
                                                <p className="text-slate-300 leading-relaxed">{offer.note || 'Completion proof submitted for final review.'}</p>
                                                <a href={offer.report_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sky-400 font-semibold hover:underline"><Icon name="external-link" className="w-3.5 h-3.5" />Open public Drive report</a>
                                                <div className="flex flex-wrap gap-2 pt-1">
                                                  <button onClick={() => changeOfferStatus(offer, 'In Progress', 'Final review requested changes; contractor must resubmit proof.')} className="px-3 py-2 rounded-lg border border-slate-600 text-slate-300 font-semibold">Request changes</button>
                                                  <button onClick={() => changeOfferStatus(offer, 'Approved', 'Final proof approved; contractor payment released.')} className="px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold">Approve & release payment</button>
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                          {offer.status === 'Approved' && <div className="mt-2 flex items-center gap-2 text-emerald-400"><Icon name="circle-check" className="w-4 h-4" /><span>Final review approved · Payment released</span></div>}
                                          <div className="flex gap-1.5 mt-2">
                                            {offer.status === 'Sent' && <button onClick={() => changeOfferStatus(offer, 'Accepted')} className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">Accept</button>}
                                            {offer.status === 'Accepted' && <button onClick={() => changeOfferStatus(offer, 'In Progress')} className="px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-bold">Start</button>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-500 font-mono glass-card p-3 rounded-xl border border-slate-800">No contractor assigned yet.</div>
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
                            <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-mono text-slate-400 uppercase">
                              <th className="p-4">ID</th>
                              <th className="p-4">Category & Location</th>
                              <th className="p-4">Severity</th>
                              <th className="p-4">AI Confidence</th>
                              <th className="p-4">Status</th>
                              <th className="p-4 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 text-xs">
                            {displayedAdminReports.map((item) => (
                              <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                                <td className="p-4 font-mono font-bold text-sky-400">{item.id}</td>
                                <td className="p-4">
                                  <div className="font-semibold text-white">{item.category}</div>
                                  <div className="text-[11px] text-slate-400 font-mono">{item.location}</div>
                                </td>
                                <td className="p-4">
                                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${item.severity === 'Critical'
                                      ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                    }`}>
                                    {item.severity}
                                  </span>
                                </td>
                                <td className="p-4 font-mono text-[11px] text-slate-300">
                                  {item.confidence}
                                </td>
                                <td className="p-4">
                                  <span className="text-slate-300 font-medium font-mono">{item.status}</span>
                                </td>
                                <td className="p-4 text-right">
                                  <div className="flex justify-end gap-2">
                                    {(item.needs_review || item.status === 'Needs Review') && <button onClick={() => setReviewReport(item)} className="px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-300 font-semibold text-xs">Review AI</button>}
                                    <button
                                      disabled={!nextOperationalStatus(item) || item.needs_review || item.status === 'Needs Review'}
                                      onClick={() => nextOperationalStatus(item) && updateStatus(item, nextOperationalStatus(item))}
                                      className="px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 disabled:opacity-30 text-sky-400 font-semibold text-xs transition-all"
                                    >
                                      {nextOperationalStatus(item) ? `→ ${nextOperationalStatus(item)}` : 'Await proof'}
                                    </button>
                                    <button
                                      onClick={() => inspectIncident(item)}
                                      className="px-3.5 py-1.5 rounded-xl glass-card border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold text-xs transition-all shadow-sm"
                                    >
                                      Workspace
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {!displayedAdminReports.length && (
                              <tr>
                                <td colSpan="6" className="p-12 text-center text-xs text-slate-400">
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
          <footer className="border-t border-slate-800/80 bg-slate-950 py-6 mb-16 lg:mb-0">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-sky-400 flex items-center justify-center"><Icon name="activity" className="w-3.5 h-3.5 text-slate-950" /></div>
                <span className="text-slate-200 font-bold">UrbanFix</span>
                <span>· Report, track, verify</span>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => setActiveTab('community')} className="hover:text-sky-400">Community cleanup</button>
                <button onClick={() => setActiveTab('contractor')} className="hover:text-sky-400">Contractor portal</button>
              </div>
            </div>
          </footer>
          <ReviewDialog report={reviewReport} busy={reviewBusy} onClose={() => !reviewBusy && setReviewReport(null)} onConfirm={confirmHumanReview} />
        </div>
      );
    }
