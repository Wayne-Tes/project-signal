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
        background: '#0b0c0f',
        color: '#8a8f99',
        fontFamily: 'IBM Plex Sans, sans-serif',
      }}
    >
      Loading…
    </div>
  ),
});

export default function Home() {
  return <ClientApp />;
}
