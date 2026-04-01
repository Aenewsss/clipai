import { useState, useCallback, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import type { Job, Cut, ClipSuggestion, SocialAccount, SocialPlatform, Publish } from '@/types';
import ProfileMenu from '@/components/ProfileMenu';

type AppState = 'processing' | 'done' | 'error';
type Style = 'viral' | 'educational' | 'funny' | 'dramatic';

interface VideoInfo {
  title: string;
  author: string;
  thumbnail: string;
  videoId: string;
}

interface RecentJob {
  id: string;
  title?: string;
  status: string;
  created_at: string;
}

interface RecentCut {
  id: string;
  job_id: string;
  clip_index: number;
  title: string;
  clip_url?: string;
  clip_vertical_url?: string;
  status: string;
}

interface ActiveJob {
  id: string;
  url: string;
  videoInfo: VideoInfo | null;
  style: Style;
  job: Job | null;
  cuts: Cut[];
  publishes: Publish[];
  state: AppState;
  error: string;
  activeStep: number;
  selectedClips: Set<number>;
  enqueueing: boolean;
  downloadingAll: boolean;
}

const STEPS = [
  { key: 'downloading', label: 'Baixando áudio do vídeo', icon: '📥' },
  { key: 'transcribing', label: 'Transcrevendo com Whisper', icon: '🎙️' },
  { key: 'analyzing', label: 'IA analisando melhores momentos', icon: '🧠' },
  { key: 'done', label: 'Cortes identificados!', icon: '✂️' },
];

const STEP_INDEX: Record<string, number> = {
  queued: 0, downloading: 0, transcribing: 1, analyzing: 2, done: 3,
};

const STORAGE_KEY = 'clipai_session';

interface SavedSessions {
  jobs: Array<{ jobId: string; videoInfo: VideoInfo | null; url: string; style: Style }>;
}

const PLATFORM_LABELS: Record<SocialPlatform, { name: string; icon: string; color: string }> = {
  tiktok: { name: 'TikTok', icon: '🎵', color: '#010101' },
  instagram: { name: 'Instagram', icon: '📸', color: '#E1306C' },
  youtube: { name: 'YouTube', icon: '▶', color: '#FF0000' },
};

const ALL_PLATFORMS: SocialPlatform[] = ['tiktok', 'instagram', 'youtube'];

export default function Home() {
  const { data: session } = useSession();

  // URL input form
  const [url, setUrl] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [style, setStyle] = useState<Style>('viral');

  // Multi-job state
  const [activeJobs, setActiveJobs] = useState<Record<string, ActiveJob>>({});

  // Social / publish state (shared, keyed by cutId)
  const [showAccountsPanel, setShowAccountsPanel] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [publishingCut, setPublishingCut] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, Set<SocialPlatform>>>({});
  const [showBulkPublishModal, setShowBulkPublishModal] = useState(false);
  const [bulkPublishJobId, setBulkPublishJobId] = useState<string | null>(null);
  const [bulkPlatforms, setBulkPlatforms] = useState<Set<SocialPlatform>>(new Set());
  const [scheduleDate, setScheduleDate] = useState<Record<string, string>>({});
  const [bulkScheduleDate, setBulkScheduleDate] = useState('');
  const [publishTitle, setPublishTitle] = useState<Record<string, string>>({});
  const [publishDescription, setPublishDescription] = useState<Record<string, string>>({});
  const [previewMode, setPreviewMode] = useState<Record<string, 'h' | 'v'>>({});
  const [generatingVertical, setGeneratingVertical] = useState<Set<string>>(new Set());

  // History
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [recentCuts, setRecentCuts] = useState<Record<string, RecentCut[]>>({});
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // Per-job polling intervals
  const pollRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const cutPollRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const publishPollRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Save sessions to localStorage whenever activeJobs changes
  useEffect(() => {
    const sessions: SavedSessions = {
      jobs: Object.values(activeJobs).map(aj => ({
        jobId: aj.id, videoInfo: aj.videoInfo, url: aj.url, style: aj.style,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [activeJobs]);

  const getPreview = (id: string) => previewMode[id] ?? 'h';
  const setPreview = (id: string, mode: 'h' | 'v') =>
    setPreviewMode(prev => ({ ...prev, [id]: mode }));

  const updateActiveJob = (jobId: string, updates: Partial<ActiveJob>) => {
    setActiveJobs(prev => prev[jobId] ? { ...prev, [jobId]: { ...prev[jobId], ...updates } } : prev);
  };

  const stopJobPolling = (jobId: string) => {
    if (pollRefs.current[jobId]) { clearInterval(pollRefs.current[jobId]); delete pollRefs.current[jobId]; }
  };
  const stopCutPolling = (jobId: string) => {
    if (cutPollRefs.current[jobId]) { clearInterval(cutPollRefs.current[jobId]); delete cutPollRefs.current[jobId]; }
  };
  const stopPublishPolling = (jobId: string) => {
    if (publishPollRefs.current[jobId]) { clearInterval(publishPollRefs.current[jobId]); delete publishPollRefs.current[jobId]; }
  };

  const startPublishPolling = useCallback((jobId: string) => {
    stopPublishPolling(jobId);
    publishPollRefs.current[jobId] = setInterval(async () => {
      try {
        const res = await fetch(`/api/social/publishes?jobId=${jobId}`);
        if (!res.ok) return;
        const data: Publish[] = await res.json();
        updateActiveJob(jobId, { publishes: data });
        if (data.length > 0 && data.every(p => p.status === 'done' || p.status === 'error')) {
          stopPublishPolling(jobId);
        }
      } catch {}
    }, 3000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startCutPolling = useCallback((jobId: string) => {
    stopCutPolling(jobId);
    cutPollRefs.current[jobId] = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/cuts`);
        if (!res.ok) return;
        const data: Cut[] = await res.json();
        updateActiveJob(jobId, { cuts: data });
        if (data.length > 0 && data.every(c => c.status === 'done' || c.status === 'error')) {
          stopCutPolling(jobId);
        }
      } catch {}
    }, 3000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startJobPolling = useCallback((jobId: string) => {
    stopJobPolling(jobId);
    pollRefs.current[jobId] = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const jobData: Job = await res.json();
        updateActiveJob(jobId, { job: jobData, activeStep: STEP_INDEX[jobData.step] ?? 0 });

        if (jobData.status === 'done') {
          stopJobPolling(jobId);
          updateActiveJob(jobId, {
            state: 'done',
            selectedClips: new Set(jobData.clips?.map((_: ClipSuggestion, i: number) => i) ?? []),
          });
        } else if (jobData.status === 'error') {
          stopJobPolling(jobId);
          updateActiveJob(jobId, { state: 'error', error: jobData.error || 'Erro ao processar o vídeo' });
        }
      } catch {}
    }, 3000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSocialAccounts = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/social/accounts');
      if (res.ok) setSocialAccounts(await res.json());
    } catch {}
  }, [session]);

  useEffect(() => { loadSocialAccounts(); }, [loadSocialAccounts]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected')) { loadSocialAccounts(); setShowAccountsPanel(true); window.history.replaceState({}, '', '/'); }
    if (params.get('error')) { window.history.replaceState({}, '', '/'); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRecentJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) return;
      setRecentJobs(await res.json());
    } catch {}
  }, []);

  const loadCutsForJob = async (jobId: string) => {
    if (recentCuts[jobId]) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}/cuts`);
      if (!res.ok) return;
      const data: RecentCut[] = await res.json();
      setRecentCuts(prev => ({ ...prev, [jobId]: data.filter(c => c.status === 'done') }));
    } catch {}
  };

  const restoreJob = useCallback(async (saved: { jobId: string; videoInfo: VideoInfo | null; url: string; style: Style }) => {
    const { jobId, videoInfo: savedInfo, url: savedUrl, style: savedStyle } = saved;
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;
      const jobData: Job = await res.json();

      if (jobData.status === 'done') {
        const [cutsRes, pubRes] = await Promise.all([
          fetch(`/api/jobs/${jobId}/cuts`),
          fetch(`/api/social/publishes?jobId=${jobId}`),
        ]);
        const cutsData: Cut[] = cutsRes.ok ? await cutsRes.json() : [];
        const pubData: Publish[] = pubRes.ok ? await pubRes.json() : [];

        setActiveJobs(prev => ({
          ...prev,
          [jobId]: {
            id: jobId, url: savedUrl ?? '', videoInfo: savedInfo, style: savedStyle ?? 'viral',
            job: jobData, cuts: cutsData, publishes: pubData,
            state: 'done', error: '', activeStep: 3,
            selectedClips: new Set(jobData.clips?.map((_: ClipSuggestion, i: number) => i) ?? []),
            enqueueing: false, downloadingAll: false,
          },
        }));

        if (cutsData.some(c => c.status === 'pending' || c.status === 'processing')) startCutPolling(jobId);
        if (pubData.some(p => p.status === 'pending' || p.status === 'processing')) startPublishPolling(jobId);
      } else if (jobData.status === 'pending' || jobData.status === 'processing') {
        setActiveJobs(prev => ({
          ...prev,
          [jobId]: {
            id: jobId, url: savedUrl ?? '', videoInfo: savedInfo, style: savedStyle ?? 'viral',
            job: jobData, cuts: [], publishes: [],
            state: 'processing', error: '', activeStep: STEP_INDEX[jobData.step] ?? 0,
            selectedClips: new Set(), enqueueing: false, downloadingAll: false,
          },
        }));
        startJobPolling(jobId);
      }
    } catch {}
  }, [startCutPolling, startPublishPolling, startJobPolling]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore sessions on mount
  useEffect(() => {
    loadRecentJobs();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      // Support old single-job format { jobId, ... } and new { jobs: [...] }
      const jobs: any[] = parsed.jobs ?? [parsed];
      jobs.filter(j => j?.jobId).forEach(j => restoreJob(j));
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchVideoInfo = useCallback(async (videoUrl: string) => {
    try {
      setUrlLoading(true);
      const res = await fetch(`/api/video-info?url=${encodeURIComponent(videoUrl)}`);
      setVideoInfo(res.ok ? await res.json() : null);
    } catch {
      setVideoInfo(null);
    } finally {
      setUrlLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) { setVideoInfo(null); return; }
    if (!/(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts)/.test(url)) return;
    const t = setTimeout(() => fetchVideoInfo(url), 600);
    return () => clearTimeout(t);
  }, [url, fetchVideoInfo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), style, min_duration: 60, max_duration: 90 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar job');

      const jobId: string = data.jobId;
      setActiveJobs(prev => ({
        ...prev,
        [jobId]: {
          id: jobId, url: url.trim(), videoInfo, style,
          job: null, cuts: [], publishes: [],
          state: 'processing', error: '', activeStep: 0,
          selectedClips: new Set(), enqueueing: false, downloadingAll: false,
        },
      }));
      startJobPolling(jobId);
      setUrl('');
      setVideoInfo(null);
    } catch (err: any) {
      alert(err.message || 'Erro desconhecido ao criar job');
    }
  };

  const removeJob = (jobId: string) => {
    stopJobPolling(jobId); stopCutPolling(jobId); stopPublishPolling(jobId);
    setActiveJobs(prev => { const next = { ...prev }; delete next[jobId]; return next; });
    loadRecentJobs();
  };

  const toggleClip = (jobId: string, index: number) => {
    setActiveJobs(prev => {
      if (!prev[jobId]) return prev;
      const next = new Set(prev[jobId].selectedClips);
      if (next.has(index)) next.delete(index); else next.add(index);
      return { ...prev, [jobId]: { ...prev[jobId], selectedClips: next } };
    });
  };

  const generateVertical = async (cutId: string) => {
    setGeneratingVertical(prev => new Set(prev).add(cutId));
    try {
      const res = await fetch(`/api/cuts/${cutId}/vertical`, { method: 'POST' });
      if (!res.ok) throw new Error('Falha ao gerar vertical');
      const { clip_vertical_url } = await res.json();
      setActiveJobs(prev => {
        const next = { ...prev };
        for (const [jobId, aj] of Object.entries(next)) {
          const idx = aj.cuts.findIndex(c => c.id === cutId);
          if (idx !== -1) {
            const cuts = [...aj.cuts];
            cuts[idx] = { ...cuts[idx], clip_vertical_url };
            next[jobId] = { ...aj, cuts };
          }
        }
        return next;
      });
      setPreview(cutId, 'v');
    } catch (err: any) {
      alert(`Erro ao gerar vertical: ${err.message}`);
    } finally {
      setGeneratingVertical(prev => { const s = new Set(prev); s.delete(cutId); return s; });
    }
  };

  const handleCut = async (jobId: string) => {
    const aj = activeJobs[jobId];
    if (!aj?.job || aj.selectedClips.size === 0) return;
    updateActiveJob(jobId, { enqueueing: true, cuts: [] });
    stopCutPolling(jobId);
    try {
      const sorted = [...aj.selectedClips].sort((a, b) => a - b);
      const clipsToEnqueue = sorted.map(originalIdx => {
        const c = aj.job!.clips![originalIdx];
        return { clip_index: originalIdx, title: c.title, start_time: c.start_time, end_time: c.end_time };
      });
      const res = await fetch(`/api/jobs/${jobId}/cuts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips: clipsToEnqueue }),
      });
      if (res.status === 402) throw new Error((await res.json()).error || 'Limite de cortes gratuitos atingido.');
      if (!res.ok) throw new Error((await res.json()).error || 'Erro ao enfileirar cortes');
      startCutPolling(jobId);
    } catch (err: any) {
      updateActiveJob(jobId, { error: err.message });
    } finally {
      updateActiveJob(jobId, { enqueueing: false });
    }
  };

  const handlePublishCut = async (jobId: string, cutId: string, platforms: SocialPlatform[]) => {
    if (!session) return;
    setPublishingCut(cutId);
    try {
      const rawDate = scheduleDate[cutId];
      const scheduledAt = rawDate ? new Date(rawDate).toISOString() : undefined;
      const title = publishTitle[cutId];
      const description = publishDescription[cutId];
      const overrides = (title || description) ? { [cutId]: { title, description } } : undefined;
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutIds: [cutId], platforms, ...(scheduledAt ? { scheduledAt } : {}), ...(overrides ? { overrides } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      startPublishPolling(jobId);
    } catch (err: any) {
      updateActiveJob(jobId, { error: err.message });
    } finally {
      setPublishingCut(null);
    }
  };

  const handleBulkPublish = async () => {
    if (!bulkPublishJobId || bulkPlatforms.size === 0) return;
    const aj = activeJobs[bulkPublishJobId];
    const doneCutIds = aj?.cuts.filter(c => c.status === 'done').map(c => c.id) ?? [];
    if (!doneCutIds.length) return;
    try {
      const scheduledAt = bulkScheduleDate ? new Date(bulkScheduleDate).toISOString() : undefined;
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutIds: doneCutIds, platforms: [...bulkPlatforms], ...(scheduledAt ? { scheduledAt } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      startPublishPolling(bulkPublishJobId);
      setShowBulkPublishModal(false);
      setBulkScheduleDate('');
    } catch (err: any) {
      updateActiveJob(bulkPublishJobId, { error: err.message });
    }
  };

  const handleDownloadAll = async (jobId: string) => {
    updateActiveJob(jobId, { downloadingAll: true });
    try {
      const a = document.createElement('a');
      a.href = `/api/jobs/${jobId}/cuts/download`;
      a.download = `clips_${jobId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      updateActiveJob(jobId, { downloadingAll: false });
    }
  };

  const toggleCutPlatform = (cutId: string, platform: SocialPlatform) => {
    setSelectedPlatforms(prev => {
      const set = new Set(prev[cutId] ?? []);
      if (set.has(platform)) set.delete(platform); else set.add(platform);
      return { ...prev, [cutId]: set };
    });
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const getScoreClass = (score: number) => score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low';
  const getYoutubeClipUrl = (videoId: string, start: number) =>
    `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(start)}s`;

  const isLoggedIn = !!session;
  const connectedPlatforms = new Set(socialAccounts.map(a => a.platform));
  const activeJobsList = Object.values(activeJobs);
  const hasActiveJobs = activeJobsList.length > 0;
  const bulkDoneCuts = bulkPublishJobId ? (activeJobs[bulkPublishJobId]?.cuts.filter(c => c.status === 'done') ?? []) : [];

  return (
    <>
      <Head>
        <title>ClipAI — Cortes automáticos com IA</title>
        <meta name="description" content="Transforme vídeos longos do YouTube em clips virais para TikTok usando inteligência artificial." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✂️</text></svg>" />
      </Head>

      {/* Accounts Panel Modal */}
      {showAccountsPanel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowAccountsPanel(false); }}>
          <div style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Contas conectadas</h2>
              <button onClick={() => setShowAccountsPanel(false)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.2rem', opacity: 0.6 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ALL_PLATFORMS.map(platform => {
                const info = PLATFORM_LABELS[platform];
                const account = socialAccounts.find(a => a.platform === platform);
                return (
                  <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ fontSize: '1.4rem' }}>{info.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{info.name}</div>
                      {account ? <div style={{ fontSize: '0.78rem', opacity: 0.6 }}>@{account.platform_username}</div>
                        : <div style={{ fontSize: '0.78rem', opacity: 0.5 }}>Não conectado</div>}
                    </div>
                    {account ? (
                      <button className="clip-btn" style={{ fontSize: '0.78rem', padding: '5px 12px', color: '#ef4444' }}
                        onClick={async () => { await fetch('/api/social/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: account.id }) }); loadSocialAccounts(); }}>
                        Desconectar
                      </button>
                    ) : (
                      <a href={`/api/social/connect/${platform}`} className="clip-btn primary" style={{ fontSize: '0.78rem', padding: '5px 12px' }}>Conectar</a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Publish Modal */}
      {showBulkPublishModal && bulkPublishJobId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowBulkPublishModal(false); setBulkScheduleDate(''); } }}>
          <div style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 400 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>Publicar {bulkDoneCuts.length} corte{bulkDoneCuts.length !== 1 ? 's' : ''} em:</h2>
            <p style={{ opacity: 0.5, fontSize: '0.85rem', margin: '0 0 20px' }}>Selecione as plataformas</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {ALL_PLATFORMS.filter(p => connectedPlatforms.has(p)).map(platform => {
                const info = PLATFORM_LABELS[platform];
                const selected = bulkPlatforms.has(platform);
                return (
                  <button key={platform}
                    onClick={() => setBulkPlatforms(prev => { const s = new Set(prev); if (s.has(platform)) s.delete(platform); else s.add(platform); return s; })}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: selected ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${selected ? 'rgba(124,58,237,0.6)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8, cursor: 'pointer', color: 'inherit' }}>
                    <span>{info.icon}</span><span style={{ fontWeight: 600 }}>{info.name}</span>
                    {selected && <span style={{ marginLeft: 'auto', color: '#7c3aed' }}>✓</span>}
                  </button>
                );
              })}
              {connectedPlatforms.size === 0 && (
                <p style={{ opacity: 0.5, fontSize: '0.85rem' }}>Nenhuma conta conectada. <button onClick={() => { setShowBulkPublishModal(false); setShowAccountsPanel(true); }} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', textDecoration: 'underline' }}>Conectar agora</button></p>
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.8rem', opacity: 0.6, marginBottom: 6 }}>Agendar para (opcional)</label>
              <input type="datetime-local" value={bulkScheduleDate} onChange={e => setBulkScheduleDate(e.target.value)} min={new Date().toISOString().slice(0, 16)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'inherit', fontSize: '0.9rem', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="clip-btn" style={{ flex: 1 }} onClick={() => { setShowBulkPublishModal(false); setBulkScheduleDate(''); }}>Cancelar</button>
              <button className="clip-btn primary" style={{ flex: 1 }} disabled={bulkPlatforms.size === 0} onClick={handleBulkPublish}>
                {bulkScheduleDate ? '🕐 Agendar' : '📤 Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">✂️</div>
          <span>ClipAI</span>
        </div>
        <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/biblioteca" className="nav-link">Biblioteca</Link>
          {isLoggedIn && (
            <button className="nav-link" onClick={() => setShowAccountsPanel(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Contas sociais
              {socialAccounts.length > 0 && <span style={{ background: '#7c3aed', color: '#fff', borderRadius: 10, fontSize: '0.7rem', padding: '1px 6px' }}>{socialAccounts.length}</span>}
            </button>
          )}
          <ProfileMenu />
        </div>
      </header>

      {/* URL Input — always visible */}
      {!hasActiveJobs ? (
        <section className="hero">
          <div className="hero-badge"><span className="hero-badge-dot" />Powered by Groq Whisper + Claude AI</div>
          <h1>Transforme vídeos em <span>clips virais</span> com IA</h1>
          <p>
            Cole a URL de um vídeo do YouTube. A IA transcreve, analisa e identifica os melhores momentos para TikTok, Reels e Shorts — automaticamente.
          </p>
          <p style={{ opacity: 0.6, fontSize: '0.9rem', marginTop: -8 }}>
            Processe vários vídeos ao mesmo tempo — cole uma URL, clique em Gerar Cortes e repita para outros vídeos em paralelo.
          </p>

          <div className="input-area">
            <form onSubmit={handleSubmit}>
              <div className="url-input-wrapper">
                <input type="text" className="url-input" placeholder="https://youtube.com/watch?v=..." value={url} onChange={e => setUrl(e.target.value)} autoFocus />
                <button type="submit" className="url-submit" disabled={!url.trim() || urlLoading}>
                  {urlLoading ? 'Buscando...' : 'Gerar Cortes'}
                </button>
              </div>
            </form>
            <div className="options-row">
              {(['viral', 'educational', 'funny', 'dramatic'] as Style[]).map(s => (
                <button key={s} className={`option-chip ${style === s ? 'active' : ''}`} onClick={() => setStyle(s)}>
                  {{ viral: '🔥 Viral', educational: '📚 Educativo', funny: '😂 Engraçado', dramatic: '🎭 Dramático' }[s]}
                </button>
              ))}
            </div>
            {videoInfo && (
              <div className="video-preview">
                {videoInfo.thumbnail && <img src={videoInfo.thumbnail} alt={videoInfo.title} />}
                <div className="video-preview-info"><h3>{videoInfo.title}</h3><p>{videoInfo.author}</p></div>
              </div>
            )}
          </div>

          {/* Recent history */}
          {recentJobs.length > 0 && (
            <div style={{ marginTop: 64, width: '100%', maxWidth: 900, margin: '64px auto 0' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 16, opacity: 0.9 }}>🕒 Últimos cortes gerados</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {recentJobs.map(rj => {
                  const isExpanded = expandedJob === rj.id;
                  const jobCuts = recentCuts[rj.id];
                  const date = new Date(rj.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={rj.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
                      <button onClick={async () => { if (isExpanded) setExpandedJob(null); else { setExpandedJob(rj.id); await loadCutsForJob(rj.id); } }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rj.title ?? 'Vídeo sem título'}</div>
                          <div style={{ fontSize: '0.78rem', opacity: 0.5, marginTop: 2 }}>{date}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <a href={`/api/jobs/${rj.id}/cuts/download`} download onClick={e => e.stopPropagation()} className="clip-btn primary" style={{ padding: '6px 14px', fontSize: '0.8rem' }}>⬇ ZIP</a>
                          <span style={{ opacity: 0.5, fontSize: '0.9rem' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {!jobCuts ? <div style={{ opacity: 0.5, fontSize: '0.85rem' }}>Carregando cortes...</div>
                            : jobCuts.length === 0 ? <div style={{ opacity: 0.5, fontSize: '0.85rem' }}>Nenhum corte concluído neste job.</div>
                            : jobCuts.map(cut => (
                              <div key={cut.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 8 }}>{String(cut.clip_index + 1).padStart(2, '0')}. {cut.title}</div>
                                {cut.clip_url && (
                                  <>
                                    {cut.clip_vertical_url && (
                                      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                                        {(['h', 'v'] as const).map(m => (
                                          <button key={m} onClick={() => setPreview(cut.id, m)} style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.15)', background: getPreview(cut.id) === m ? 'rgba(124,58,237,0.4)' : 'transparent', color: '#fff', cursor: 'pointer' }}>
                                            {m === 'h' ? '↔ Horizontal' : '↕ Vertical'}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'center', background: '#000', borderRadius: 6 }}>
                                      <video key={getPreview(cut.id)} src={getPreview(cut.id) === 'v' && cut.clip_vertical_url ? cut.clip_vertical_url : cut.clip_url} controls preload="metadata" style={{ maxHeight: 320, width: getPreview(cut.id) === 'v' ? 'auto' : '100%', borderRadius: 6 }} />
                                    </div>
                                    <a href={getPreview(cut.id) === 'v' && cut.clip_vertical_url ? cut.clip_vertical_url : cut.clip_url} download target="_blank" rel="noopener noreferrer" className="clip-btn" style={{ display: 'inline-block', marginTop: 8, fontSize: '0.8rem', padding: '5px 12px' }}>
                                      ⬇ Baixar {getPreview(cut.id) === 'v' ? 'vertical' : ''}
                                    </a>
                                  </>
                                )}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="features" style={{ marginTop: 80 }}>
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon" style={{ background: 'rgba(124, 58, 237, 0.1)' }}>🎙️</div>
                <h3>Transcrição Inteligente</h3>
                <p>Usa as legendas do YouTube ou Whisper para transcrever com timestamps precisos.</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon" style={{ background: 'rgba(236, 72, 153, 0.1)' }}>🧠</div>
                <h3>Análise com IA</h3>
                <p>Claude identifica ganchos, arcos narrativos e momentos de alto engajamento.</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon" style={{ background: 'rgba(16, 185, 129, 0.1)' }}>✂️</div>
                <h3>Cortes Precisos</h3>
                <p>Timestamps exatos para clips de 30-90s que funcionam sozinhos, sem contexto extra.</p>
              </div>
            </div>
          </div>
        </section>
      ) : (
        /* Active jobs layout */
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 24px 60px' }}>
          {/* Compact URL input bar */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
            <form onSubmit={handleSubmit}>
              <div className="url-input-wrapper">
                <input type="text" className="url-input" placeholder="Cole outro vídeo para processar em paralelo..." value={url} onChange={e => setUrl(e.target.value)} />
                <button type="submit" className="url-submit" disabled={!url.trim() || urlLoading}>
                  {urlLoading ? 'Buscando...' : '+ Adicionar'}
                </button>
              </div>
            </form>
            {videoInfo && (
              <div className="video-preview" style={{ marginTop: 12, marginBottom: 0 }}>
                {videoInfo.thumbnail && <img src={videoInfo.thumbnail} alt={videoInfo.title} />}
                <div className="video-preview-info"><h3>{videoInfo.title}</h3><p>{videoInfo.author}</p></div>
              </div>
            )}
            <div className="options-row" style={{ marginTop: 10 }}>
              {(['viral', 'educational', 'funny', 'dramatic'] as Style[]).map(s => (
                <button key={s} className={`option-chip ${style === s ? 'active' : ''}`} onClick={() => setStyle(s)}>
                  {{ viral: '🔥 Viral', educational: '📚 Educativo', funny: '😂 Engraçado', dramatic: '🎭 Dramático' }[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Job cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {activeJobsList.map(aj => {
              const doneCuts = aj.cuts.filter(c => c.status === 'done');
              const getPublishesForCut = (cutId: string) => aj.publishes.filter(p => p.cut_id === cutId);

              return (
                <div key={aj.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden' }}>
                  {/* Card header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                    {aj.videoInfo?.thumbnail && <img src={aj.videoInfo.thumbnail} alt="" style={{ width: 54, height: 40, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {aj.job?.title ?? aj.videoInfo?.title ?? aj.url}
                      </div>
                      <div style={{ fontSize: '0.78rem', opacity: 0.5, marginTop: 2 }}>
                        {aj.state === 'processing' && (['Baixando...', 'Transcrevendo...', 'Analisando...', 'Processando...'][aj.activeStep] ?? 'Processando...')}
                        {aj.state === 'done' && <span style={{ color: '#4ade80' }}>✓ {aj.job?.clips?.length ?? 0} cortes identificados{aj.cuts.length > 0 ? ` · ${doneCuts.length}/${aj.cuts.length} cortados` : ''}</span>}
                        {aj.state === 'error' && <span style={{ color: '#ef4444' }}>⚠ Erro ao processar</span>}
                      </div>
                    </div>
                    <button onClick={() => removeJob(aj.id)} title="Remover" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.4, fontSize: '1rem', padding: '4px 8px', flexShrink: 0 }}>✕</button>
                  </div>

                  {/* Processing */}
                  {aj.state === 'processing' && (
                    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                      <div className="processing-spinner" />
                      <div className="processing-steps" style={{ width: '100%', maxWidth: 480 }}>
                        {STEPS.map((step, i) => (
                          <div key={step.key} className={`step ${i === aj.activeStep ? 'active' : ''} ${i < aj.activeStep ? 'done' : ''}`}>
                            <div className="step-icon">{i < aj.activeStep ? '✓' : step.icon}</div>
                            <span>{step.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {aj.state === 'error' && (
                    <div style={{ padding: 20 }}><div className="error-box">{aj.error}</div></div>
                  )}

                  {/* Done — clips + actions */}
                  {aj.state === 'done' && aj.job && (
                    <div style={{ padding: 20 }}>
                      {aj.error && <div className="error-box" style={{ marginBottom: 16 }}>{aj.error}</div>}

                      <div className="clips-grid">
                        {aj.job.clips?.map((clip, i) => {
                          const cut = aj.cuts.find(c => c.clip_index === i);
                          const isSelected = aj.selectedClips.has(i);
                          const cutPublishes = cut ? getPublishesForCut(cut.id) : [];
                          const cutSelectedPlatforms = cut ? (selectedPlatforms[cut.id] ?? new Set<SocialPlatform>()) : new Set<SocialPlatform>();

                          return (
                            <div className={`clip-card ${isSelected ? 'selected' : ''}`} key={i} style={{ animationDelay: `${i * 0.1}s` }}>
                              <div className="clip-card-header">
                                <input type="checkbox" checked={isSelected} onChange={() => toggleClip(aj.id, i)} style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }} />
                                <div className="clip-rank">{i + 1}</div>
                                <div className="clip-title">
                                  <h3>{clip.title}</h3>
                                  <p>{formatTime(clip.start_time)} → {formatTime(clip.end_time)} · {Math.round(clip.end_time - clip.start_time)}s</p>
                                </div>
                                <div className={`viral-score ${getScoreClass(clip.viral_score)}`}>⚡ {clip.viral_score}/10</div>
                              </div>

                              {cut?.status === 'done' && cut.clip_url && (
                                <div style={{ marginTop: 12 }}>
                                  <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                                    {cut.clip_vertical_url ? (
                                      (['h', 'v'] as const).map(m => (
                                        <button key={m} onClick={() => setPreview(cut.id, m)} style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.15)', background: getPreview(cut.id) === m ? 'rgba(124,58,237,0.4)' : 'transparent', color: '#fff', cursor: 'pointer' }}>
                                          {m === 'h' ? '↔ Horizontal' : '↕ Vertical'}
                                        </button>
                                      ))
                                    ) : (
                                      <button onClick={() => generateVertical(cut.id)} disabled={generatingVertical.has(cut.id)}
                                        style={{ fontSize: '0.75rem', padding: '3px 12px', borderRadius: 20, border: '1px solid rgba(124,58,237,0.5)', background: 'rgba(124,58,237,0.15)', color: '#fff', cursor: generatingVertical.has(cut.id) ? 'wait' : 'pointer', opacity: generatingVertical.has(cut.id) ? 0.7 : 1 }}>
                                        {generatingVertical.has(cut.id) ? '⏳ Gerando vertical...' : '↕ Gerar vertical'}
                                      </button>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'center', background: '#000', borderRadius: 8 }}>
                                    <video key={getPreview(cut.id)} src={getPreview(cut.id) === 'v' && cut.clip_vertical_url ? cut.clip_vertical_url : cut.clip_url} controls preload="metadata"
                                      style={{ maxHeight: 360, width: getPreview(cut.id) === 'v' ? 'auto' : '100%', borderRadius: 8 }} />
                                  </div>
                                </div>
                              )}

                              <div className="clip-hook">
                                <div className="clip-hook-label">Gancho de abertura</div>
                                <p>"{clip.hook}"</p>
                              </div>
                              <p className="clip-reason">{clip.reason}</p>

                              <div className="clip-actions">
                                {aj.videoInfo?.videoId && (
                                  <a href={getYoutubeClipUrl(aj.videoInfo.videoId, clip.start_time)} target="_blank" rel="noopener noreferrer" className="clip-btn">▶ Ver no YouTube</a>
                                )}
                                {cut?.status === 'done' && cut.clip_url ? (
                                  <a href={cut.clip_url} download target="_blank" rel="noopener noreferrer" className="clip-btn primary">⬇ Baixar clip</a>
                                ) : cut?.status === 'processing' ? (
                                  <span className="clip-btn" style={{ opacity: 0.6, cursor: 'default' }}>✂️ Cortando...</span>
                                ) : cut?.status === 'pending' ? (
                                  <span className="clip-btn" style={{ opacity: 0.6, cursor: 'default' }}>⏳ Na fila...</span>
                                ) : cut?.status === 'error' ? (
                                  <span className="clip-btn" style={{ opacity: 0.6, cursor: 'default', color: 'red' }}>⚠ Erro no corte</span>
                                ) : (
                                  <button className="clip-btn" onClick={() => { const text = `${clip.title}\n⏱ ${formatTime(clip.start_time)} → ${formatTime(clip.end_time)}\n🎣 ${clip.hook}\n💡 ${clip.reason}\n⚡ Score: ${clip.viral_score}/10`; navigator.clipboard.writeText(text); }}>📋 Copiar info</button>
                                )}
                              </div>

                              {cut?.status === 'done' && isLoggedIn && (
                                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                                  {cutPublishes.length > 0 && (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                                      {cutPublishes.map(p => {
                                        const info = PLATFORM_LABELS[p.platform];
                                        return (
                                          <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', padding: '3px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                                            {info.icon}
                                            {p.status === 'pending' && (p.scheduled_at ? <span title={new Date(p.scheduled_at).toLocaleString('pt-BR')}>🕐 {new Date(p.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> : '⏳')}
                                            {p.status === 'processing' && '⏳'}
                                            {p.status === 'done' && <a href={p.platform_post_url ?? '#'} target="_blank" rel="noopener noreferrer" style={{ color: '#4ade80', textDecoration: 'none' }}>✓ Ver post</a>}
                                            {p.status === 'error' && <span style={{ color: '#ef4444' }} title={p.error ?? ''}>✕</span>}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                                    <input type="text" placeholder={`Título — padrão: "${cut.title}"`} value={publishTitle[cut.id] ?? ''} onChange={e => setPublishTitle(prev => ({ ...prev, [cut.id]: e.target.value }))}
                                      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: 'inherit', fontSize: '0.82rem', width: '100%', boxSizing: 'border-box' }} />
                                    <textarea placeholder="Descrição / legenda (opcional)" value={publishDescription[cut.id] ?? ''} onChange={e => setPublishDescription(prev => ({ ...prev, [cut.id]: e.target.value }))} rows={2}
                                      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: 'inherit', fontSize: '0.82rem', width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
                                  </div>
                                  {connectedPlatforms.size > 0 ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: '0.78rem', opacity: 0.5 }}>Publicar em:</span>
                                      {ALL_PLATFORMS.filter(p => connectedPlatforms.has(p)).map(platform => {
                                        const info = PLATFORM_LABELS[platform];
                                        const selected = cutSelectedPlatforms.has(platform);
                                        return (
                                          <button key={platform} onClick={() => toggleCutPlatform(cut.id, platform)}
                                            style={{ padding: '4px 10px', borderRadius: 20, fontSize: '0.78rem', cursor: 'pointer', background: selected ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)', border: `1px solid ${selected ? 'rgba(124,58,237,0.7)' : 'rgba(255,255,255,0.1)'}`, color: 'inherit' }}>
                                            {info.icon} {info.name}
                                          </button>
                                        );
                                      })}
                                      {cutSelectedPlatforms.size > 0 && (
                                        <>
                                          <input type="datetime-local" value={scheduleDate[cut.id] ?? ''} onChange={e => setScheduleDate(prev => ({ ...prev, [cut.id]: e.target.value }))} min={new Date().toISOString().slice(0, 16)} title="Agendar para (opcional)"
                                            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'inherit', fontSize: '0.75rem' }} />
                                          <button className="clip-btn primary" style={{ padding: '4px 12px', fontSize: '0.78rem' }} disabled={publishingCut === cut.id} onClick={() => handlePublishCut(aj.id, cut.id, [...cutSelectedPlatforms])}>
                                            {publishingCut === cut.id ? '...' : scheduleDate[cut.id] ? '🕐 Agendar' : '📤 Publicar'}
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  ) : (
                                    <button onClick={() => setShowAccountsPanel(true)} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: '0.8rem', padding: 0, textDecoration: 'underline' }}>Conectar conta para publicar</button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Bottom actions */}
                      <div style={{ textAlign: 'center', marginTop: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                          <button className="clip-btn primary" style={{ padding: '12px 28px', fontSize: '0.95rem' }} disabled={aj.enqueueing || aj.selectedClips.size === 0} onClick={() => handleCut(aj.id)}>
                            {aj.enqueueing ? 'Enfileirando...' : aj.cuts.length > 0 ? `✂️ Re-enfileirar ${aj.selectedClips.size} corte${aj.selectedClips.size !== 1 ? 's' : ''}` : `✂️ Gerar ${aj.selectedClips.size} corte${aj.selectedClips.size !== 1 ? 's' : ''} selecionado${aj.selectedClips.size !== 1 ? 's' : ''}`}
                          </button>
                          {doneCuts.length > 0 && (
                            <button className="clip-btn" style={{ padding: '12px 28px', fontSize: '0.95rem' }} disabled={aj.downloadingAll} onClick={() => handleDownloadAll(aj.id)}>
                              {aj.downloadingAll ? 'Preparando...' : `⬇ Baixar todos (${doneCuts.length}) em ZIP`}
                            </button>
                          )}
                          {doneCuts.length > 0 && isLoggedIn && connectedPlatforms.size > 0 && (
                            <button className="clip-btn" style={{ padding: '12px 28px', fontSize: '0.95rem' }}
                              onClick={() => { setBulkPlatforms(new Set()); setBulkPublishJobId(aj.id); setShowBulkPublishModal(true); }}>
                              📤 Publicar selecionados
                            </button>
                          )}
                        </div>
                        {aj.cuts.length > 0 && (
                          <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>{doneCuts.length}/{aj.cuts.length} cortes prontos</p>
                        )}
                        {aj.publishes.length > 0 && (
                          <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>{aj.publishes.filter(p => p.status === 'done').length}/{aj.publishes.length} publicações concluídas</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <footer className="footer">
        <p>ClipAI — Feito com Groq Whisper + Claude AI · {new Date().getFullYear()}</p>
      </footer>
    </>
  );
}
