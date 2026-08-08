import type { Metadata } from 'next';
import { APPEARANCE_BOOT_SCRIPT } from '@/design-system';
import './globals.css';

export const metadata: Metadata = {
  title: 'Project Signal — Brand Intelligence',
  description: 'AI-powered brand intelligence platform by Wayne Strydom',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` is required and is not a shortcut: the boot
    // script below mutates these exact attributes before React hydrates, so the
    // server's markup and the client's first render legitimately differ. Without
    // it React logs a hydration mismatch on every load for a difference it was
    // told to expect.
    <html lang="en" data-theme="light" data-sidebar="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/*
          Poppins (display, to 800 for the extra-bold headings and metric
          figures) + Open Sans (body) — the house typefaces from the Aurora
          design system. Poppins stands in for the licensed Museo Sans.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Open+Sans:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        {/*
          Applies the stored theme BEFORE first paint. Without it the server
          renders the default light shell and the client corrects it on mount,
          which a dark-theme user sees as a white flash on every navigation.
          The script only reads our own keys and writes nothing.
        */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
