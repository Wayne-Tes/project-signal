'use client';
import { useState, useEffect, useRef } from 'react';

interface Options {
  duration?: number;
  from?: number;
  decimals?: number;
  play?: boolean;
  delay?: number;
}

export function useCountUp(to: number, options: Options = {}): string | number {
  const { duration = 1400, from = 0, decimals = 0, play = true, delay = 0 } = options;
  const [val, setVal] = useState(from);
  const raf = useRef(0);

  useEffect(() => {
    if (!play) {
      setVal(to);
      return;
    }
    let start: number | undefined;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (ts: number) => {
      if (start === undefined) start = ts;
      const elapsed = ts - start - delay;
      if (elapsed < 0) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, elapsed / duration);
      setVal(from + (to - from) * ease(t));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [to, play, duration, from, delay]);

  return decimals > 0 ? val.toFixed(decimals) : Math.round(val);
}
