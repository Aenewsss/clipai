import { useState, useCallback, useEffect, useRef } from 'react';
import Head from 'next/head';
import { useSession, signIn, signOut } from 'next-auth/react';
import type { Job, Cut, ClipSuggestion, SocialAccount, SocialPlatform, Publish } from '@/types';

type AppState = 'idle' | 'loading-info' | 'processing' | 'done' | 'error';
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
  status: string;
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

interface SavedSession {
  jobId: string;
  videoInfo: VideoInfo | null;
  url: string;
  style: Style;
}

const PLATFORM_LABELS: Record<SocialPlatform, { name: string; icon: string; color: string }> = {
  tiktok: { name: 'TikTok', icon: '🎵', color: '#010101' },
  instagram: { name: 'Instagram', icon: '📸', color: '#E1306C' },
  youtube: { name: 'YouTube', icon: '▶', color: '#FF0000' },
};

const ALL_PLATFORMS: SocialPlatform[] = ['tiktok', 'instagram', 'youtube'];

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();
  const [url, setUrl] = useState('');
  const [state, setState] = useState<AppState>('idle');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [style, setStyle] = useState<Style>('viral');
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [selectedClips, setSelectedClips] = useState<Set<number>>(new Set());
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [enqueueing, setEnqueueing] = useState(false);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [recentCuts, setRecentCuts] = useState<Record<string, RecentCut[]>>({});
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  // Social media state
  const [showAccountsPanel, setShowAccountsPanel] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [publishes, setPublishes] = useState<Publish[]>([]);
  const [publishingCut, setPublishingCut] = useState<string | null>(null); // cut id being published
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, Set<SocialPlatform>>>({}); // cutId -> platforms
  const [showBulkPublishModal, setShowBulkPublishModal] = useState(false);
  const [bulkPlatforms, setBulkPlatforms] = useState<Set<SocialPlatform>>(new Set());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cutPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const publishPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  const stopCutPolling = () => {
    if (cutPollRef.current) { clearInterval(cutPollRef.current); cutPollRef.current = null; }
  };
  const stopPublishPolling = () => {
    if (publishPollRef.current) { clearInterval(publishPollRef.current); publishPollRef.current = null; }
  };

  // Load social accounts when logged in
  const loadSocialAccounts = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/social/accounts');
      if (res.ok) setSocialAccounts(await res.json());
    } catch {}
  }, [session]);

  useEffect(() => {
    loadSocialAccounts();
  }, [loadSocialAccounts]);

  // Handle ?connected= and ?error= query params from OAuth callback
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const oauthError = params.get('error');

    if (connected) {
      loadSocialAccounts();
      setShowAccountsPanel(true);
      window.history.replaceState({}, '', '/');
    }
    if (oauthError) {
      setError(`Erro ao conectar conta: ${oauthError}`);
      window.history.replaceState({}, '', '/');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startPublishPolling = useCallback((jobId: string) => {
    stopPublishPolling();
    publishPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/social/publishes?jobId=${jobId}`);
        if (!res.ok) return;
        const data: Publish[] = await res.json();
        setPublishes(data);
        const allDone = data.every(p => p.status === 'done' || p.status === 'error');
        if (allDone && data.length > 0) stopPublishPolling();
      } catch {}
    }, 3000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startCutPolling = (jobId: string) => {
    stopCutPolling();
    cutPollRef.current = setInterval(async () => {
      const res = await fetch(`/api/jobs/${jobId}/cuts`);
      const data: Cut[] = await res.json();
      setCuts(data);
      const allDone = data.length > 0 && data.every(c => c.status === 'done' || c.status === 'error');
      if (allDone) stopCutPolling();
    }, 3000);
  };

  const startJobPolling = useCallback((jobId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const statusRes = await fetch(`/api/jobs/${jobId}`);
        const jobData: Job = await statusRes.json();
        setJob(jobData);
        setActiveStep(STEP_INDEX[jobData.step] ?? 0);

        if (jobData.status === 'done') {
          stopPolling();
          setSelectedClips(new Set(jobData.clips?.map((_: ClipSuggestion, i: number) => i) ?? []));
          setState('done');
        } else if (jobData.status === 'error') {
          stopPolling();
          setError(jobData.error || 'Erro ao processar o vídeo');
          setState('error');
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {}
    }, 3000);
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

  // Restore session from localStorage on mount
  useEffect(() => {
    loadRecentJobs();

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    let session: SavedSession;
    try { session = JSON.parse(raw); } catch { return; }

    const { jobId, videoInfo: savedVideoInfo, url: savedUrl, style: savedStyle } = session;
    if (!jobId) return;

    (async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) { localStorage.removeItem(STORAGE_KEY); return; }
        const jobData: Job = await res.json();

        setUrl(savedUrl ?? '');
        setStyle(savedStyle ?? 'viral');
        if (savedVideoInfo) setVideoInfo(savedVideoInfo);

        if (jobData.status === 'done') {
          setJob(jobData);
          setActiveStep(3);
          setSelectedClips(new Set(jobData.clips?.map((_: ClipSuggestion, i: number) => i) ?? []));
          setState('done');

          const cutsRes = await fetch(`/api/jobs/${jobId}/cuts`);
          if (cutsRes.ok) {
            const cutsData: Cut[] = await cutsRes.json();
            setCuts(cutsData);
            const hasInProgress = cutsData.some(c => c.status === 'pending' || c.status === 'processing');
            if (hasInProgress) startCutPolling(jobId);
          }

          // Restore publish polling
          const pubRes = await fetch(`/api/social/publishes?jobId=${jobId}`);
          if (pubRes.ok) {
            const pubData: Publish[] = await pubRes.json();
            setPublishes(pubData);
            const hasInProgress = pubData.some(p => p.status === 'pending' || p.status === 'processing');
            if (hasInProgress) startPublishPolling(jobId);
          }
        } else if (jobData.status === 'processing' || jobData.status === 'pending') {
          setJob(jobData);
          setActiveStep(STEP_INDEX[jobData.step] ?? 0);
          setState('processing');
          startJobPolling(jobId);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchVideoInfo = useCallback(async (videoUrl: string) => {
    try {
      setState('loading-info');
      const res = await fetch(`/api/video-info?url=${encodeURIComponent(videoUrl)}`);
      if (!res.ok) { setVideoInfo(null); setState('idle'); return; }
      setVideoInfo(await res.json());
      setState('idle');
    } catch {
      setVideoInfo(null);
      setState('idle');
    }
  }, []);

  useEffect(() => {
    if (!url) { setVideoInfo(null); return; }
    const isYoutube = /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts)/.test(url);
    if (!isYoutube) return;
    const timer = setTimeout(() => fetchVideoInfo(url), 600);
    return () => clearTimeout(timer);
  }, [url, fetchVideoInfo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setState('processing');
    setError('');
    setJob(null);
    setActiveStep(0);
    stopPolling();

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), style, min_duration: 60, max_duration: 90 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar job');

      const jobId = data.jobId;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId, videoInfo, url: url.trim(), style }));
      startJobPolling(jobId);
    } catch (err: any) {
      setError(err.message || 'Erro desconhecido');
      setState('error');
    }
  };

  const handleReset = () => {
    stopPolling(); stopCutPolling(); stopPublishPolling();
    localStorage.removeItem(STORAGE_KEY);
    setState('idle');
    setJob(null); setCuts([]); setPublishes([]);
    setError(''); setUrl(''); setVideoInfo(null);
    setActiveStep(0); setSelectedClips(new Set());
    loadRecentJobs();
  };

  const toggleClip = (index: number) => {
    setSelectedClips(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const handleCut = async () => {
    if (!job || selectedClips.size === 0) return;
    setEnqueueing(true); setCuts([]); stopCutPolling();
    try {
      const clipsToEnqueue = job.clips
        ?.filter((_, i) => selectedClips.has(i))
        .map((c, arrIdx) => {
          const originalIdx = [...selectedClips].sort((a, b) => a - b)[arrIdx];
          return { clip_index: originalIdx, title: c.title, start_time: c.start_time, end_time: c.end_time };
        }) ?? [];

      const res = await fetch(`/api/jobs/${job.id}/cuts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips: clipsToEnqueue }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Erro ao enfileirar cortes');
      startCutPolling(job.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEnqueueing(false);
    }
  };

  const handlePublishCut = async (cutId: string, platforms: SocialPlatform[]) => {
    if (!job || !session) return;
    setPublishingCut(cutId);
    try {
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutIds: [cutId], platforms }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      startPublishPolling(job.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPublishingCut(null);
    }
  };

  const handleBulkPublish = async () => {
    if (!job || bulkPlatforms.size === 0) return;
    const doneCutIds = cuts.filter(c => c.status === 'done').map(c => c.id);
    if (!doneCutIds.length) return;

    try {
      const res = await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutIds: doneCutIds, platforms: [...bulkPlatforms] }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      startPublishPolling(job.id);
      setShowBulkPublishModal(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDownloadAll = async () => {
    if (!job) return;
    setDownloadingAll(true);
    try {
      const a = document.createElement('a');
      a.href = `/api/jobs/${job.id}/cuts/download`;
      a.download = `clips_${job.id.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setDownloadingAll(false);
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

  const doneCuts = cuts.filter(c => c.status === 'done');
  const connectedPlatforms = new Set(socialAccounts.map(a => a.platform));
  const isLoggedIn = !!session;

  const getPublishesForCut = (cutId: string) => publishes.filter(p => p.cut_id === cutId);

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
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowAccountsPanel(false); }}
        >
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
                      {account ? (
                        <div style={{ fontSize: '0.78rem', opacity: 0.6 }}>@{account.platform_username}</div>
                      ) : (
                        <div style={{ fontSize: '0.78rem', opacity: 0.5 }}>Não conectado</div>
                      )}
                    </div>
                    {account ? (
                      <button
                        className="clip-btn"
                        style={{ fontSize: '0.78rem', padding: '5px 12px', color: '#ef4444' }}
                        onClick={async () => {
                          await fetch('/api/social/disconnect', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ accountId: account.id }),
                          });
                          loadSocialAccounts();
                        }}
                      >
                        Desconectar
                      </button>
                    ) : (
                      <a href={`/api/social/connect/${platform}`} className="clip-btn primary" style={{ fontSize: '0.78rem', padding: '5px 12px' }}>
                        Conectar
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Publish Modal */}
      {showBulkPublishModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowBulkPublishModal(false); }}
        >
          <div style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 400 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>Publicar {doneCuts.length} corte{doneCuts.length !== 1 ? 's' : ''} em:</h2>
            <p style={{ opacity: 0.5, fontSize: '0.85rem', margin: '0 0 20px' }}>Selecione as plataformas</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {ALL_PLATFORMS.filter(p => connectedPlatforms.has(p)).map(platform => {
                const info = PLATFORM_LABELS[platform];
                const selected = bulkPlatforms.has(platform);
                return (
                  <button
                    key={platform}
                    onClick={() => setBulkPlatforms(prev => { const s = new Set(prev); if (s.has(platform)) s.delete(platform); else s.add(platform); return s; })}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: selected ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${selected ? 'rgba(124,58,237,0.6)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8, cursor: 'pointer', color: 'inherit' }}
                  >
                    <span>{info.icon}</span>
                    <span style={{ fontWeight: 600 }}>{info.name}</span>
                    {selected && <span style={{ marginLeft: 'auto', color: '#7c3aed' }}>✓</span>}
                  </button>
                );
              })}
              {connectedPlatforms.size === 0 && (
                <p style={{ opacity: 0.5, fontSize: '0.85rem' }}>Nenhuma conta conectada. <button onClick={() => { setShowBulkPublishModal(false); setShowAccountsPanel(true); }} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', textDecoration: 'underline' }}>Conectar agora</button></p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="clip-btn" style={{ flex: 1 }} onClick={() => setShowBulkPublishModal(false)}>Cancelar</button>
              <button className="clip-btn primary" style={{ flex: 1 }} disabled={bulkPlatforms.size === 0} onClick={handleBulkPublish}>Publicar</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="header">
        <div className="logo" onClick={handleReset} style={{ cursor: 'pointer' }}>
          <div className="logo-icon">✂️</div>
          <span>ClipAI</span>
        </div>
        <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {state === 'done' && (
            <button className="nav-link" onClick={handleReset}>← Novo vídeo</button>
          )}
          {sessionStatus !== 'loading' && (
            isLoggedIn ? (
              <>
                <button
                  className="nav-link"
                  onClick={() => setShowAccountsPanel(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {session.user?.image && <img src={session.user.image} alt="" style={{ width: 22, height: 22, borderRadius: '50%' }} />}
                  Contas sociais
                  {socialAccounts.length > 0 && (
                    <span style={{ background: '#7c3aed', color: '#fff', borderRadius: 10, fontSize: '0.7rem', padding: '1px 6px' }}>
                      {socialAccounts.length}
                    </span>
                  )}
                </button>
                <button className="nav-link" onClick={() => signOut()} style={{ opacity: 0.6 }}>Sair</button>
              </>
            ) : (
              <button className="clip-btn primary" style={{ padding: '6px 16px', fontSize: '0.85rem' }} onClick={() => signIn('google')}>
                Entrar com Google
              </button>
            )
          )}
        </div>
      </header>

      {/* IDLE / INPUT STATE */}
      {(state === 'idle' || state === 'loading-info' || state === 'error') && (
        <section className="hero">
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            Powered by Groq Whisper + Claude AI
          </div>

          <h1>
            Transforme vídeos em{' '}
            <span>clips virais</span>{' '}
            com IA
          </h1>

          <p>
            Cole a URL de um vídeo do YouTube. A IA transcreve, analisa e identifica
            os melhores momentos para TikTok, Reels e Shorts — automaticamente.
          </p>

          <div className="input-area">
            <form onSubmit={handleSubmit}>
              <div className="url-input-wrapper">
                <input
                  type="text"
                  className="url-input"
                  placeholder="https://youtube.com/watch?v=..."
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="url-submit" disabled={!url.trim() || state === 'loading-info'}>
                  {state === 'loading-info' ? 'Buscando...' : 'Gerar Cortes'}
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
                <div className="video-preview-info">
                  <h3>{videoInfo.title}</h3>
                  <p>{videoInfo.author}</p>
                </div>
              </div>
            )}

            {state === 'error' && error && <div className="error-box">{error}</div>}
          </div>

          {/* Recent cuts history */}
          {recentJobs.length > 0 && (
            <div style={{ marginTop: 64, width: '100%', maxWidth: 900, margin: '64px auto 0' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 16, opacity: 0.9 }}>
                🕒 Últimos cortes gerados
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {recentJobs.map(rj => {
                  const isExpanded = expandedJob === rj.id;
                  const jobCuts = recentCuts[rj.id];
                  const date = new Date(rj.created_at).toLocaleDateString('pt-BR', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  });
                  return (
                    <div key={rj.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
                      <button
                        onClick={async () => {
                          if (isExpanded) { setExpandedJob(null); }
                          else { setExpandedJob(rj.id); await loadCutsForJob(rj.id); }
                        }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left', gap: 12 }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {rj.title ?? 'Vídeo sem título'}
                          </div>
                          <div style={{ fontSize: '0.78rem', opacity: 0.5, marginTop: 2 }}>{date}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <a href={`/api/jobs/${rj.id}/cuts/download`} download onClick={e => e.stopPropagation()} className="clip-btn primary" style={{ padding: '6px 14px', fontSize: '0.8rem' }}>
                            ⬇ ZIP
                          </a>
                          <span style={{ opacity: 0.5, fontSize: '0.9rem' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {!jobCuts ? (
                            <div style={{ opacity: 0.5, fontSize: '0.85rem' }}>Carregando cortes...</div>
                          ) : jobCuts.length === 0 ? (
                            <div style={{ opacity: 0.5, fontSize: '0.85rem' }}>Nenhum corte concluído neste job.</div>
                          ) : (
                            jobCuts.map(cut => (
                              <div key={cut.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 8 }}>
                                  {String(cut.clip_index + 1).padStart(2, '0')}. {cut.title}
                                </div>
                                {cut.clip_url && (
                                  <video src={cut.clip_url} controls preload="metadata" style={{ width: '100%', borderRadius: 6, background: '#000', maxHeight: 320 }} />
                                )}
                                {cut.clip_url && (
                                  <a href={cut.clip_url} download target="_blank" rel="noopener noreferrer" className="clip-btn" style={{ display: 'inline-block', marginTop: 8, fontSize: '0.8rem', padding: '5px 12px' }}>
                                    ⬇ Baixar
                                  </a>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Features */}
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
      )}

      {/* PROCESSING STATE */}
      {state === 'processing' && (
        <section className="hero">
          <div className="processing">
            <div className="processing-spinner" />
            <h2>Analisando o vídeo...</h2>
            <p>Isso pode levar até 1 minuto dependendo do tamanho do vídeo.</p>
            {videoInfo && (
              <div className="video-preview" style={{ marginTop: 24, marginBottom: 0 }}>
                {videoInfo.thumbnail && <img src={videoInfo.thumbnail} alt={videoInfo.title} />}
                <div className="video-preview-info">
                  <h3>{videoInfo.title}</h3>
                  <p>{videoInfo.author}</p>
                </div>
              </div>
            )}
            <div className="processing-steps">
              {STEPS.map((step, i) => (
                <div key={step.key} className={`step ${i === activeStep ? 'active' : ''} ${i < activeStep ? 'done' : ''}`}>
                  <div className="step-icon">{i < activeStep ? '✓' : step.icon}</div>
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* RESULTS STATE */}
      {state === 'done' && job && (
        <section className="results">
          <div className="results-header">
            <h2>✂️ {job.clips?.length || 0} Cortes Identificados</h2>
            <p>{job.title}</p>
          </div>

          <div className="clips-grid">
            {job.clips?.map((clip, i) => {
              const cut = cuts.find(c => c.clip_index === i);
              const isSelected = selectedClips.has(i);
              const cutPublishes = cut ? getPublishesForCut(cut.id) : [];
              const cutSelectedPlatforms = cut ? (selectedPlatforms[cut.id] ?? new Set<SocialPlatform>()) : new Set<SocialPlatform>();

              return (
                <div className={`clip-card ${isSelected ? 'selected' : ''}`} key={i} style={{ animationDelay: `${i * 0.1}s` }}>
                  <div className="clip-card-header">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleClip(i)} style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }} />
                    <div className="clip-rank">{i + 1}</div>
                    <div className="clip-title">
                      <h3>{clip.title}</h3>
                      <p>{formatTime(clip.start_time)} → {formatTime(clip.end_time)} · {Math.round(clip.end_time - clip.start_time)}s</p>
                    </div>
                    <div className={`viral-score ${getScoreClass(clip.viral_score)}`}>⚡ {clip.viral_score}/10</div>
                  </div>

                  {cut?.status === 'done' && cut.clip_url && (
                    <video src={cut.clip_url} controls preload="metadata" style={{ width: '100%', borderRadius: 8, marginTop: 12, background: '#000', maxHeight: 360 }} />
                  )}

                  <div className="clip-hook">
                    <div className="clip-hook-label">Gancho de abertura</div>
                    <p>"{clip.hook}"</p>
                  </div>

                  <p className="clip-reason">{clip.reason}</p>

                  <div className="clip-actions">
                    {videoInfo?.videoId && (
                      <a href={getYoutubeClipUrl(videoInfo.videoId, clip.start_time)} target="_blank" rel="noopener noreferrer" className="clip-btn">
                        ▶ Ver no YouTube
                      </a>
                    )}
                    {cut?.status === 'done' && cut.clip_url ? (
                      <a href={cut.clip_url} download target="_blank" rel="noopener noreferrer" className="clip-btn primary">
                        ⬇ Baixar clip
                      </a>
                    ) : cut?.status === 'processing' ? (
                      <span className="clip-btn" style={{ opacity: 0.6, cursor: 'default' }}>✂️ Cortando...</span>
                    ) : cut?.status === 'pending' ? (
                      <span className="clip-btn" style={{ opacity: 0.6, cursor: 'default' }}>⏳ Na fila...</span>
                    ) : cut?.status === 'error' ? (
                      <span className="clip-btn" style={{ opacity: 0.6, cursor: 'default', color: 'red' }}>⚠ Erro no corte</span>
                    ) : (
                      <button className="clip-btn" onClick={() => { const text = `${clip.title}\n⏱ ${formatTime(clip.start_time)} → ${formatTime(clip.end_time)}\n🎣 ${clip.hook}\n💡 ${clip.reason}\n⚡ Score: ${clip.viral_score}/10`; navigator.clipboard.writeText(text); }}>
                        📋 Copiar info
                      </button>
                    )}
                  </div>

                  {/* Social publish section — only when cut is done and user is logged in */}
                  {cut?.status === 'done' && isLoggedIn && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                      {/* Publish status badges */}
                      {cutPublishes.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                          {cutPublishes.map(p => {
                            const info = PLATFORM_LABELS[p.platform];
                            return (
                              <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', padding: '3px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                                {info.icon}
                                {p.status === 'pending' && '⏳'}
                                {p.status === 'processing' && '⏳'}
                                {p.status === 'done' && (
                                  <a href={p.platform_post_url ?? '#'} target="_blank" rel="noopener noreferrer" style={{ color: '#4ade80', textDecoration: 'none' }}>✓ Ver post</a>
                                )}
                                {p.status === 'error' && <span style={{ color: '#ef4444' }} title={p.error ?? ''}>✕</span>}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Platform selector + publish button */}
                      {connectedPlatforms.size > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.78rem', opacity: 0.5 }}>Publicar em:</span>
                          {ALL_PLATFORMS.filter(p => connectedPlatforms.has(p)).map(platform => {
                            const info = PLATFORM_LABELS[platform];
                            const selected = cutSelectedPlatforms.has(platform);
                            return (
                              <button
                                key={platform}
                                onClick={() => cut && toggleCutPlatform(cut.id, platform)}
                                style={{ padding: '4px 10px', borderRadius: 20, fontSize: '0.78rem', cursor: 'pointer', background: selected ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)', border: `1px solid ${selected ? 'rgba(124,58,237,0.7)' : 'rgba(255,255,255,0.1)'}`, color: 'inherit' }}
                              >
                                {info.icon} {info.name}
                              </button>
                            );
                          })}
                          {cutSelectedPlatforms.size > 0 && cut && (
                            <button
                              className="clip-btn primary"
                              style={{ padding: '4px 12px', fontSize: '0.78rem' }}
                              disabled={publishingCut === cut.id}
                              onClick={() => cut && handlePublishCut(cut.id, [...cutSelectedPlatforms])}
                            >
                              {publishingCut === cut.id ? '...' : '📤 Publicar'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <button onClick={() => setShowAccountsPanel(true)} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: '0.8rem', padding: 0, textDecoration: 'underline' }}>
                          Conectar conta para publicar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom actions */}
          <div style={{ textAlign: 'center', marginTop: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {error && <div className="error-box">{error}</div>}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="clip-btn primary" style={{ padding: '14px 32px', fontSize: '1rem' }} disabled={enqueueing || selectedClips.size === 0} onClick={handleCut}>
                {enqueueing ? 'Enfileirando...' : cuts.length > 0 ? `✂️ Re-enfileirar ${selectedClips.size} corte${selectedClips.size !== 1 ? 's' : ''}` : `✂️ Gerar ${selectedClips.size} corte${selectedClips.size !== 1 ? 's' : ''} selecionado${selectedClips.size !== 1 ? 's' : ''}`}
              </button>
              {doneCuts.length > 0 && (
                <button className="clip-btn" style={{ padding: '14px 32px', fontSize: '1rem' }} disabled={downloadingAll} onClick={handleDownloadAll}>
                  {downloadingAll ? 'Preparando...' : `⬇ Baixar todos (${doneCuts.length}) em ZIP`}
                </button>
              )}
              {doneCuts.length > 0 && isLoggedIn && connectedPlatforms.size > 0 && (
                <button className="clip-btn" style={{ padding: '14px 32px', fontSize: '1rem' }} onClick={() => { setBulkPlatforms(new Set()); setShowBulkPublishModal(true); }}>
                  📤 Publicar selecionados
                </button>
              )}
            </div>
            {cuts.length > 0 && (
              <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
                {doneCuts.length}/{cuts.length} cortes prontos — worker processando um a um
              </p>
            )}
            {publishes.length > 0 && (
              <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
                {publishes.filter(p => p.status === 'done').length}/{publishes.length} publicações concluídas
              </p>
            )}
          </div>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button className="nav-link" onClick={handleReset}>← Analisar outro vídeo</button>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>ClipAI — Feito com Groq Whisper + Claude AI · {new Date().getFullYear()}</p>
      </footer>
    </>
  );
}
