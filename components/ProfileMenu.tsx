import { useState, useEffect, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import type { UserPlanInfo } from '@/types';

export default function ProfileMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [planInfo, setPlanInfo] = useState<UserPlanInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const fetchPlan = useCallback(() => {
    fetch('/api/stripe/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setPlanInfo(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetchPlan();
  }, [status, fetchPlan]);

  // Quando retorna do Stripe com ?checkout=success, faz polling até o plano mudar para pro
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return;

    window.history.replaceState({}, '', window.location.pathname);

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      fetch('/api/stripe/status')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          setPlanInfo(d);
          if (d.plan === 'pro' || attempts >= 12) clearInterval(interval);
        })
        .catch(() => { if (attempts >= 12) clearInterval(interval); });
    }, 2500);

    return () => clearInterval(interval);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { setLoading(false); }
  };

  const handleManage = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { setLoading(false); }
  };

  if (status === 'loading') return null;

  if (status !== 'authenticated') {
    return (
      <button className="clip-btn primary" style={{ padding: '6px 16px', fontSize: '0.85rem' }} onClick={() => signIn('google')}>
        Entrar com Google
      </button>
    );
  }

  const user = session.user;

  return (
    <>
      {/* Upgrade Modal */}
      {showUpgrade && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowUpgrade(false); }}
        >
          <div style={{ background: '#1a1a2e', border: '1px solid rgba(124,58,237,0.4)', borderRadius: 20, padding: 40, width: '100%', maxWidth: 460, textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>⚡</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.5rem' }}>Limite atingido</h2>
            <p style={{ opacity: 0.7, marginBottom: 8 }}>
              Você usou todos os seus <strong style={{ color: '#fff' }}>10 cortes gratuitos</strong> deste mês.
            </p>
            <p style={{ opacity: 0.6, marginBottom: 28, fontSize: '0.9rem' }}>
              Assine o plano Pro para fazer cortes ilimitados todo mês.
            </p>
            <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 24, textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>Plano Pro</div>
              <ul style={{ margin: 0, padding: '0 0 0 20px', opacity: 0.8, lineHeight: 1.8, fontSize: '0.9rem' }}>
                <li>Cortes ilimitados por mês</li>
                <li>Publicação em redes sociais</li>
                <li>Corte vertical com rastreamento de rosto</li>
                <li>Suporte prioritário</li>
              </ul>
            </div>
            <button
              className="clip-btn primary"
              style={{ width: '100%', padding: '14px', fontSize: '1rem', marginBottom: 10 }}
              onClick={handleUpgrade}
              disabled={loading}
            >
              {loading ? 'Redirecionando...' : 'Assinar Pro →'}
            </button>
            <button
              style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.5, cursor: 'pointer', fontSize: '0.85rem' }}
              onClick={() => setShowUpgrade(false)}
            >
              Continuar no plano gratuito
            </button>
          </div>
        </div>
      )}

      {/* Avatar button */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '3px 10px 3px 4px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'inherit' }}
        >
          {user?.image
            ? <img src={user.image} alt="" style={{ width: 28, height: 28, borderRadius: '50%', display: 'block' }} />
            : <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700 }}>{user?.name?.[0] ?? '?'}</div>
          }
          {planInfo?.plan === 'pro' && (
            <span style={{ fontSize: '0.72rem', background: 'linear-gradient(135deg,#7c3aed,#a78bfa)', borderRadius: 6, padding: '1px 6px', fontWeight: 700, letterSpacing: '0.03em' }}>PRO</span>
          )}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.5 }}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 100, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, width: 240, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>

              {/* User info */}
              <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 12 }}>
                {user?.image
                  ? <img src={user.image} alt="" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
                  : <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>{user?.name?.[0] ?? '?'}</div>
                }
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
                </div>
              </div>

              {/* Plan */}
              <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {planInfo?.plan === 'pro' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.8rem', background: 'linear-gradient(135deg,#7c3aed,#a78bfa)', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>PRO</span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>Cortes ilimitados</span>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>Plano Free</span>
                      <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>{planInfo?.cutsThisMonth ?? 0}/10 cortes</span>
                    </div>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, ((planInfo?.cutsThisMonth ?? 0) / 10) * 100)}%`, background: (planInfo?.cutsThisMonth ?? 0) >= 10 ? '#ef4444' : '#7c3aed', borderRadius: 99, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ padding: '6px' }}>
                {planInfo?.plan === 'pro' ? (
                  <button
                    onClick={() => { setOpen(false); handleManage(); }}
                    disabled={loading}
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'inherit', padding: '9px 10px', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span>💳</span> {loading ? 'Redirecionando...' : 'Gerenciar assinatura'}
                  </button>
                ) : (
                  <button
                    onClick={() => { setOpen(false); setShowUpgrade(true); }}
                    style={{ width: '100%', textAlign: 'left', background: 'linear-gradient(135deg,rgba(124,58,237,0.2),rgba(167,139,250,0.1))', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', padding: '9px 10px', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontFamily: 'inherit' }}
                  >
                    <span>⚡</span> Fazer upgrade para Pro
                  </button>
                )}
                <button
                  onClick={() => { setOpen(false); signOut(); }}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'inherit', padding: '9px 10px', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10, opacity: 0.6, fontFamily: 'inherit' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.opacity = '0.6'; }}
                >
                  <span>→</span> Sair
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
