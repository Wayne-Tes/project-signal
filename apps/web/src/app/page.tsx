'use client';

import dynamic from 'next/dynamic';

// Auth + dashboard run client-only: the Cognito SDK and the local-session store touch browser
// APIs (localStorage, sessionStorage) and must not be evaluated during server prerender.
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
