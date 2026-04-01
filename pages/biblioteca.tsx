import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import type { SocialAccount, SocialPlatform, Publish } from '@/types';
import ProfileMenu from '@/components/ProfileMenu';

interface CutRow {
  id: string;
  job_id: string;
  clip_index: number;
  title: string;
  start_time: number;
  end_time: number;
  clip_url: string;
  clip_vertical_url?: string;
  created_at: string;
  jobs: { title: string; url: string } | null;
}

const PLATFORM_LABELS: Record<SocialPlatform, { name: string; icon: string; color: string }> = {
  tiktok: { name: 'TikTok', icon: '🎵', color: '#010101' },
  instagram: { name: 'Instagram', icon: '📸', color: '#E1306C' },
  youtube: { name: 'YouTube', icon: '▶', color: '#FF0000' },
};

const ALL_PLATFORMS: SocialPlatform[] = ['tiktok', 'instagram', 'youtube'];

function fmtDuration(start: number, end: number) {
  const s = Math.round(end - start);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function PublishBadge({ status, scheduledAt }: { status: string; scheduledAt?: string }) {
  const color = status === 'done' ? 'var(--success)' : status === 'error' ? 'var(--error)' : status === 'processing' ? 'var(--warning)' : 'var(--text-muted)';
  let label: string;
  if (status === 'done') label = 'Publicado';
  else if (status === 'error') label = 'Erro';
  else if (status === 'processing') label = 'Publicando...';
  else if (scheduledAt) label = `🕐 ${new Date(scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  else label = 'Pendente';
  return (
    <span style={{ fontSize: '0.7rem', color, fontWeight: 600 }} title={scheduledAt ? new Date(scheduledAt).toLocaleString('pt-BR') : undefined}>{label}</span>
  );
}

export default function Biblioteca() {
  const { data: session, status: sessionStatus } = useSession();
  const isLoggedIn = sessionStatus === 'authenticated';

  const [cuts, setCuts] = useState<CutRow[]>([]);
  const [publishes, setPublishes] = useState<Publish[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const [loading, setLoading] = useState(false);

  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, Set<SocialPlatform>>>({});
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [scheduleDate, setScheduleDate] = useState<Record<string, string>>({}); // cutId -> datetime-local value
  const [publishTitle, setPublishTitle] = useState<Record<string, string>>({});
  const [publishDescription, setPublishDescription] = useState<Record<string, string>>({});
  const [previewMode, setPreviewMode] = useState<Record<string, 'h' | 'v'>>({});
  const [generatingVertical, setGeneratingVertical] = useState<Set<string>>(new Set());

  const getPreview = (id: string) => previewMode[id] ?? 'h';
  const setPreview = (id: string, mode: 'h' | 'v') =>
    setPreviewMode(prev => ({ ...prev, [id]: mode }));

  const generateVertical = async (cutId: string) => {
    setGeneratingVertical(prev => new Set(prev).add(cutId));
    try {
      const res = await fetch(`/api/cuts/${cutId}/vertical`, { method: 'POST' });
      if (!res.ok) throw new Error('Falha ao gerar vertical');
      const { clip_vertical_url } = await res.json();
      setCuts(prev => prev.map(c => c.id === cutId ? { ...c, clip_vertical_url } : c));
      setPreview(cutId, 'v');
    } catch (err: any) {
      alert(`Erro ao gerar vertical: ${err.message}`);
    } finally {
      setGeneratingVertical(prev => { const s = new Set(prev); s.delete(cutId); return s; });
    }
  };

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cuts?page=${p}`);
      if (!res.ok) return;
      const data = await res.json();
      setCuts(data.cuts ?? []);
      setPublishes(data.publishes ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPublishes = useCallback(async () => {
    const res = await fetch(`/api/cuts?page=${page}`);
    if (!res.ok) return;
    const data = await res.json();
    setPublishes(data.publishes ?? []);
  }, [page]);

  useEffect(() => {
    if (!isLoggedIn) return;
    loadPage(page);
  }, [isLoggedIn, page, loadPage]);

  // Poll publishes while any are pending/processing
  useEffect(() => {
    const hasPending = publishes.some(p => p.status === 'pending' || p.status === 'processing');
    if (hasPending && !pollRef.current) {
      pollRef.current = setInterval(refreshPublishes, 4000);
    } else if (!hasPending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [publishes, refreshPublishes]);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetch('/api/social/accounts').then(r => r.ok ? r.json() : []).then(setSocialAccounts).catch(() => {});
  }, [isLoggedIn]);

  const togglePlatform = (cutId: string, platform: SocialPlatform) => {
    setSelectedPlatforms(prev => {
      const set = new Set(prev[cutId] ?? []);
      if (set.has(platform)) set.delete(platform); else set.add(platform);
      return { ...prev, [cutId]: set };
    });
  };

  const getPublishesForCut = (cutId: string) =>
    publishes.filter(p => p.cut_id === cutId);

  const getPublishForPlatform = (cutId: string, platform: SocialPlatform) =>
    publishes.find(p => p.cut_id === cutId && p.platform === platform);

  const canPublish = (cutId: string, platform: SocialPlatform) => {
    const existing = getPublishForPlatform(cutId, platform);
    return !existing || existing.status === 'error';
  };

  const handlePublish = async (cutId: string) => {
    const platforms = Array.from(selectedPlatforms[cutId] ?? []);
    if (!platforms.length) return;

    const rawDate = scheduleDate[cutId];
    const scheduledAt = rawDate ? new Date(rawDate).toISOString() : undefined;
    const title = publishTitle[cutId];
    const description = publishDescription[cutId];
    const overrides = (title || description) ? { [cutId]: { title, description } } : undefined;

    setPublishing(prev => new Set([...prev, cutId]));
    try {
      await fetch('/api/social/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutIds: [cutId], platforms, ...(scheduledAt ? { scheduledAt } : {}), ...(overrides ? { overrides } : {}) }),
      });
      setSelectedPlatforms(prev => ({ ...prev, [cutId]: new Set() }));
      setScheduleDate(prev => { const s = { ...prev }; delete s[cutId]; return s; });
      await refreshPublishes();
    } finally {
      setPublishing(prev => { const s = new Set(prev); s.delete(cutId); return s; });
    }
  };

  const connectedPlatforms = new Set(socialAccounts.map(a => a.platform));

  const totalPages = Math.ceil(total / pageSize);

  if (sessionStatus === 'loading') {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Carregando...</div>;
  }

  return (
    <>
      <Head>
        <title>Biblioteca de Cortes — ClipAI</title>
      </Head>

      <header className="header">
        <Link href="/" className="logo">
          <div className="logo-icon">✂️</div>
          <span>ClipAI</span>
        </Link>
        <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" className="nav-link">← Novo vídeo</Link>
          <ProfileMenu />
        </div>
      </header>

      <main style={{ paddingTop: 80, minHeight: '100vh' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 8 }}>
              Biblioteca de Cortes
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              {total > 0 ? `${total} corte${total !== 1 ? 's' : ''} prontos para publicar` : 'Seus cortes aparecerão aqui'}
            </p>
          </div>

          {!isLoggedIn ? (
            <div style={{ textAlign: 'center', padding: '80px 24px', color: 'var(--text-muted)' }}>
              <p style={{ marginBottom: 16 }}>Faça login para ver seus cortes</p>
              <button className="clip-btn primary" onClick={() => signIn('google')}>Entrar com Google</button>
            </div>
          ) : loading && cuts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)' }}>Carregando cortes...</div>
          ) : cuts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)' }}>
              <p style={{ marginBottom: 8, fontSize: '1.1rem' }}>Nenhum corte ainda</p>
              <p style={{ fontSize: '0.9rem' }}>Analise um vídeo na página inicial para gerar cortes.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                {cuts.map(cut => {
                  const cutPublishes = getPublishesForCut(cut.id);
                  const selectedSet = selectedPlatforms[cut.id] ?? new Set<SocialPlatform>();
                  const isPublishing = publishing.has(cut.id);

                  return (
                    <div
                      key={cut.id}
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-lg)',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        transition: 'border-color 0.2s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                      {/* Video player */}
                      <div style={{ display: 'flex', gap: 4, padding: '8px 10px 0', flexWrap: 'wrap' }}>
                        {cut.clip_vertical_url ? (
                          (['h', 'v'] as const).map(m => (
                            <button key={m} onClick={() => setPreview(cut.id, m)} style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.15)', background: getPreview(cut.id) === m ? 'rgba(124,58,237,0.4)' : 'transparent', color: '#fff', cursor: 'pointer' }}>
                              {m === 'h' ? '↔ Horizontal' : '↕ Vertical'}
                            </button>
                          ))
                        ) : (
                          <button
                            onClick={() => generateVertical(cut.id)}
                            disabled={generatingVertical.has(cut.id)}
                            style={{ fontSize: '0.72rem', padding: '3px 12px', borderRadius: 20, border: '1px solid rgba(124,58,237,0.5)', background: 'rgba(124,58,237,0.15)', color: '#fff', cursor: generatingVertical.has(cut.id) ? 'wait' : 'pointer', opacity: generatingVertical.has(cut.id) ? 0.7 : 1 }}
                          >
                            {generatingVertical.has(cut.id) ? '⏳ Gerando vertical...' : '↕ Gerar vertical'}
                          </button>
                        )}
                      </div>
                      <div style={{ background: '#000', display: 'flex', justifyContent: 'center', aspectRatio: getPreview(cut.id) === 'v' ? '9/16' : '16/9', maxHeight: getPreview(cut.id) === 'v' ? 420 : undefined }}>
                        <video
                          key={getPreview(cut.id)}
                          src={getPreview(cut.id) === 'v' && cut.clip_vertical_url ? cut.clip_vertical_url : cut.clip_url}
                          controls
                          preload="metadata"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                        />
                      </div>

                      {/* Info */}
                      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', lineHeight: 1.3, marginBottom: 4 }}>{cut.title}</div>
                          {cut.jobs && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {cut.jobs.title}
                            </div>
                          )}
                        </div>

                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                          <span>⏱ {fmtDuration(cut.start_time, cut.end_time)}</span>
                        </div>

                        {/* Current publishes */}
                        {cutPublishes.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {cutPublishes.map(pub => {
                              const pl = PLATFORM_LABELS[pub.platform];
                              return (
                                <div
                                  key={pub.id}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    background: 'var(--bg-tertiary)', borderRadius: 6,
                                    padding: '3px 8px', fontSize: '0.75rem',
                                  }}
                                >
                                  <span>{pl.icon}</span>
                                  <PublishBadge status={pub.status} scheduledAt={pub.scheduled_at} />
                                  {pub.platform_post_url && (
                                    <a href={pub.platform_post_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-light)', fontSize: '0.7rem' }}>↗</a>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Platform toggles */}
                        {connectedPlatforms.size > 0 && (
                          <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                            {/* Custom title + description */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                              <input
                                type="text"
                                placeholder={`Título — padrão: "${cut.title}"`}
                                value={publishTitle[cut.id] ?? ''}
                                onChange={e => setPublishTitle(prev => ({ ...prev, [cut.id]: e.target.value }))}
                                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'inherit', fontSize: '0.75rem', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }}
                              />
                              <textarea
                                placeholder="Descrição / legenda (opcional)"
                                value={publishDescription[cut.id] ?? ''}
                                onChange={e => setPublishDescription(prev => ({ ...prev, [cut.id]: e.target.value }))}
                                rows={2}
                                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'inherit', fontSize: '0.75rem', width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                              />
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>Publicar em:</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                              {ALL_PLATFORMS.filter(p => connectedPlatforms.has(p)).map(platform => {
                                const pl = PLATFORM_LABELS[platform];
                                const existing = getPublishForPlatform(cut.id, platform);
                                const isActive = selectedSet.has(platform);
                                const disabled = !!existing && existing.status !== 'error';

                                return (
                                  <button
                                    key={platform}
                                    disabled={disabled || isPublishing}
                                    onClick={() => togglePlatform(cut.id, platform)}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 4,
                                      padding: '4px 10px', borderRadius: 6,
                                      fontSize: '0.75rem', fontWeight: 500,
                                      border: `1px solid ${isActive ? pl.color : 'var(--border)'}`,
                                      background: isActive ? `${pl.color}22` : 'transparent',
                                      color: isActive ? pl.color : 'var(--text-muted)',
                                      cursor: disabled ? 'not-allowed' : 'pointer',
                                      opacity: disabled ? 0.4 : 1,
                                      transition: 'all 0.15s',
                                      fontFamily: 'inherit',
                                    }}
                                  >
                                    {pl.icon} {pl.name}
                                  </button>
                                );
                              })}
                            </div>
                            <div style={{ marginBottom: 8 }}>
                              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Agendar para (opcional)</label>
                              <input
                                type="datetime-local"
                                value={scheduleDate[cut.id] ?? ''}
                                onChange={e => setScheduleDate(prev => ({ ...prev, [cut.id]: e.target.value }))}
                                min={new Date().toISOString().slice(0, 16)}
                                style={{
                                  width: '100%', padding: '6px 8px', borderRadius: 6, boxSizing: 'border-box',
                                  border: '1px solid var(--border)', background: 'var(--bg-tertiary)',
                                  color: 'inherit', fontSize: '0.75rem', fontFamily: 'inherit',
                                }}
                              />
                            </div>
                            <button
                              disabled={selectedSet.size === 0 || isPublishing}
                              onClick={() => handlePublish(cut.id)}
                              style={{
                                width: '100%', padding: '8px', borderRadius: 8,
                                background: selectedSet.size > 0 ? 'var(--accent)' : 'var(--bg-tertiary)',
                                color: selectedSet.size > 0 ? '#fff' : 'var(--text-muted)',
                                border: 'none', fontFamily: 'inherit', fontWeight: 600,
                                fontSize: '0.8rem', cursor: selectedSet.size > 0 ? 'pointer' : 'default',
                                transition: 'all 0.2s',
                                opacity: isPublishing ? 0.6 : 1,
                              }}
                            >
                              {isPublishing ? 'Publicando...' : scheduleDate[cut.id] ? '🕐 Agendar' : 'Publicar'}
                            </button>
                          </div>
                        )}

                        {connectedPlatforms.size === 0 && (
                          <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                            <Link href="/" style={{ fontSize: '0.75rem', color: 'var(--accent-light)' }}>
                              Conectar conta social →
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 40 }}>
                  <button
                    className="nav-link"
                    disabled={page === 0}
                    onClick={() => setPage(p => p - 1)}
                    style={{ opacity: page === 0 ? 0.3 : 1 }}
                  >
                    ← Anterior
                  </button>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    className="nav-link"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage(p => p + 1)}
                    style={{ opacity: page >= totalPages - 1 ? 0.3 : 1 }}
                  >
                    Próxima →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
