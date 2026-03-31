import { useState, useCallback, useEffect, useRef } from 'react';
import Head from 'next/head';
import type { Job, Cut, ClipSuggestion } from '@/types';

type AppState = 'idle' | 'loading-info' | 'processing' | 'done' | 'error';
type Style = 'viral' | 'educational' | 'funny' | 'dramatic';

interface VideoInfo {
  title: string;
  author: string;
  thumbnail: string;
  videoId: string;
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

export default function Home() {
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cutPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchVideoInfo = useCallback(async (videoUrl: string) => {
    try {
      setState('loading-info');
      const res = await fetch(`/api/video-info?url=${encodeURIComponent(videoUrl)}`);
      if (!res.ok) {
        setVideoInfo(null);
        setState('idle');
        return;
      }
      const data = await res.json();
      setVideoInfo(data);
      setState('idle');
    } catch {
      setVideoInfo(null);
      setState('idle');
    }
  }, []);

  // Debounced video info fetch
  useEffect(() => {
    if (!url) {
      setVideoInfo(null);
      return;
    }
    const isYoutube = /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts)/.test(url);
    if (!isYoutube) return;

    const timer = setTimeout(() => fetchVideoInfo(url), 600);
    return () => clearTimeout(timer);
  }, [url, fetchVideoInfo]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const stopCutPolling = () => {
    if (cutPollRef.current) { clearInterval(cutPollRef.current); cutPollRef.current = null; }
  };

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
          }
        } catch {
          // keep polling on transient errors
        }
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Erro desconhecido');
      setState('error');
    }
  };

  const handleReset = () => {
    stopPolling();
    stopCutPolling();
    setState('idle');
    setJob(null);
    setCuts([]);
    setError('');
    setUrl('');
    setVideoInfo(null);
    setActiveStep(0);
    setSelectedClips(new Set());
  };

  const toggleClip = (index: number) => {
    setSelectedClips(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

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

  const handleCut = async () => {
    if (!job || selectedClips.size === 0) return;
    setEnqueueing(true);
    setCuts([]);
    stopCutPolling();
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

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const getScoreClass = (score: number) => {
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  };

  const getYoutubeClipUrl = (videoId: string, start: number, end: number) => {
    return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(start)}s`;
  };

  return (
    <>
      <Head>
        <title>ClipAI — Cortes automáticos com IA</title>
        <meta name="description" content="Transforme vídeos longos do YouTube em clips virais para TikTok usando inteligência artificial." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✂️</text></svg>" />
      </Head>

      {/* Header */}
      <header className="header">
        <div className="logo" onClick={handleReset} style={{ cursor: 'pointer' }}>
          <div className="logo-icon">✂️</div>
          <span>ClipAI</span>
        </div>
        <div className="nav-links">
          {state === 'done' && (
            <button className="nav-link" onClick={handleReset}>
              ← Novo vídeo
            </button>
          )}
          <a
            className="nav-link"
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
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
                <button
                  type="submit"
                  className="url-submit"
                  disabled={!url.trim() || state === 'loading-info'}
                >
                  {state === 'loading-info' ? 'Buscando...' : 'Gerar Cortes'}
                </button>
              </div>
            </form>

            <div className="options-row">
              {(['viral', 'educational', 'funny', 'dramatic'] as Style[]).map(s => (
                <button
                  key={s}
                  className={`option-chip ${style === s ? 'active' : ''}`}
                  onClick={() => setStyle(s)}
                >
                  {{ viral: '🔥 Viral', educational: '📚 Educativo', funny: '😂 Engraçado', dramatic: '🎭 Dramático' }[s]}
                </button>
              ))}
            </div>

            {/* Video preview */}
            {videoInfo && (
              <div className="video-preview">
                {videoInfo.thumbnail && (
                  <img src={videoInfo.thumbnail} alt={videoInfo.title} />
                )}
                <div className="video-preview-info">
                  <h3>{videoInfo.title}</h3>
                  <p>{videoInfo.author}</p>
                </div>
              </div>
            )}

            {/* Error */}
            {state === 'error' && error && (
              <div className="error-box">
                {error}
              </div>
            )}
          </div>

          {/* Features */}
          <div className="features" style={{ marginTop: 80 }}>
            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-icon" style={{ background: 'rgba(124, 58, 237, 0.1)' }}>
                  🎙️
                </div>
                <h3>Transcrição Inteligente</h3>
                <p>
                  Usa as legendas do YouTube ou Whisper para transcrever com timestamps precisos.
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-icon" style={{ background: 'rgba(236, 72, 153, 0.1)' }}>
                  🧠
                </div>
                <h3>Análise com IA</h3>
                <p>
                  Claude identifica ganchos, arcos narrativos e momentos de alto engajamento.
                </p>
              </div>
              <div className="feature-card">
                <div className="feature-icon" style={{ background: 'rgba(16, 185, 129, 0.1)' }}>
                  ✂️
                </div>
                <h3>Cortes Precisos</h3>
                <p>
                  Timestamps exatos para clips de 30-90s que funcionam sozinhos, sem contexto extra.
                </p>
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
                {videoInfo.thumbnail && (
                  <img src={videoInfo.thumbnail} alt={videoInfo.title} />
                )}
                <div className="video-preview-info">
                  <h3>{videoInfo.title}</h3>
                  <p>{videoInfo.author}</p>
                </div>
              </div>
            )}

            <div className="processing-steps">
              {STEPS.map((step, i) => (
                <div
                  key={step.key}
                  className={`step ${i === activeStep ? 'active' : ''} ${i < activeStep ? 'done' : ''}`}
                >
                  <div className="step-icon">
                    {i < activeStep ? '✓' : step.icon}
                  </div>
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
              return (
                <div
                  className={`clip-card ${isSelected ? 'selected' : ''}`}
                  key={i}
                  style={{ animationDelay: `${i * 0.1}s` }}
                >
                  <div className="clip-card-header">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleClip(i)}
                      style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}
                    />
                    <div className="clip-rank">{i + 1}</div>
                    <div className="clip-title">
                      <h3>{clip.title}</h3>
                      <p>
                        {formatTime(clip.start_time)} → {formatTime(clip.end_time)}
                        {' · '}
                        {Math.round(clip.end_time - clip.start_time)}s
                      </p>
                    </div>
                    <div className={`viral-score ${getScoreClass(clip.viral_score)}`}>
                      ⚡ {clip.viral_score}/10
                    </div>
                  </div>

                  <div className="clip-hook">
                    <div className="clip-hook-label">Gancho de abertura</div>
                    <p>"{clip.hook}"</p>
                  </div>

                  <p className="clip-reason">{clip.reason}</p>

                  <div className="clip-actions">
                    {videoInfo?.videoId && (
                      <a
                        href={getYoutubeClipUrl(videoInfo.videoId, clip.start_time, clip.end_time)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="clip-btn"
                      >
                        ▶ Ver no YouTube
                      </a>
                    )}
                    {cut?.status === 'done' && cut.clip_url ? (
                      <a href={cut.clip_url} target="_blank" rel="noopener noreferrer" className="clip-btn primary">
                        ⬇ Baixar clip
                      </a>
                    ) : cut?.status === 'processing' ? (
                      <span className="clip-btn" style={{ opacity: 0.6, cursor: 'default' }}>✂️ Cortando...</span>
                    ) : cut?.status === 'error' ? (
                      <span className="clip-btn" style={{ opacity: 0.6, cursor: 'default', color: 'red' }}>⚠ Erro no corte</span>
                    ) : (
                      <button
                        className="clip-btn"
                        onClick={() => {
                          const text = `${clip.title}\n⏱ ${formatTime(clip.start_time)} → ${formatTime(clip.end_time)}\n🎣 ${clip.hook}\n💡 ${clip.reason}\n⚡ Score: ${clip.viral_score}/10`;
                          navigator.clipboard.writeText(text);
                        }}
                      >
                        📋 Copiar info
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cut / Download actions */}
          <div style={{ textAlign: 'center', marginTop: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {error && <div className="error-box">{error}</div>}
            <button
              className="clip-btn primary"
              style={{ padding: '14px 32px', fontSize: '1rem' }}
              disabled={enqueueing || selectedClips.size === 0}
              onClick={handleCut}
            >
              {enqueueing
                ? 'Enfileirando...'
                : cuts.length > 0
                  ? `✂️ Re-enfileirar ${selectedClips.size} corte${selectedClips.size !== 1 ? 's' : ''}`
                  : `✂️ Gerar ${selectedClips.size} corte${selectedClips.size !== 1 ? 's' : ''} selecionado${selectedClips.size !== 1 ? 's' : ''}`}
            </button>
            {cuts.length > 0 && (
              <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
                {cuts.filter(c => c.status === 'done').length}/{cuts.length} cortes prontos — worker processando um a um
              </p>
            )}
          </div>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button className="nav-link" onClick={handleReset}>
              ← Analisar outro vídeo
            </button>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>
          ClipAI — Feito com Groq Whisper + Claude AI · {new Date().getFullYear()}
        </p>
      </footer>
    </>
  );
}
