'use client';

import dynamic from 'next/dynamic';

// Auth + dashboard run client-only: the Firebase client SDK touches browser APIs and
// must not be evaluated during server prerender.
const ClientApp = dynamic(() => import('@/components/ClientApp').then((m) => m.ClientApp), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        color: 'var(--t2)',
        fontFamily: 'var(--font-body)',
      }}
    >
      Loading…
    </div>
  ),
});

export default function Home() {
  return <ClientApp />;
}
