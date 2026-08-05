'use client';
import { useState, useEffect, useRef } from 'react';

export function useInView(threshold = 0.3): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (!ref.current || seen) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setSeen(true);
      },
      { threshold },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, threshold]);

  return [ref, seen];
}
