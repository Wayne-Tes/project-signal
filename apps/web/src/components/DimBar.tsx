'use client';
import { useState, useEffect } from 'react';
import { useCountUp } from '@/hooks/useCountUp';
import { scoreColor } from '@/lib/utils';
import { Delta } from './primitives';
import type { Dimension } from '@/lib/types';

export function DimBar({
  dim,
  play,
  delay = 0,
  onClick,
}: {
  dim: Dimension;
  play: boolean;
  delay?: number;
  onClick?: () => void;
}) {
  const shown = useCountUp(dim.score, { play, duration: 1300, delay });
  const [w, setW] = useState(0);

  useEffect(() => {
    if (play) {
      const t = setTimeout(() => setW(dim.score), delay + 60);
      return () => clearTimeout(t);
    }
  }, [play, delay, dim.score]);

  const col = scoreColor(dim.score);
  return (
    <button className="dimbar" onClick={onClick}>
      <div className="dimbar-top">
        <span className="dimbar-label">{dim.label}</span>
        <span className="dimbar-val" style={{ color: col }}>
          {shown}
          <Delta value={dim.score - dim.prev} />
        </span>
      </div>
      <div className="dimbar-track">
        <div className="dimbar-fill" style={{ width: `${w}%`, background: col }} />
        <div
          className="dimbar-prev"
          style={{ left: `${dim.prev}%` }}
          title={`Previous ${dim.prev}`}
        />
      </div>
    </button>
  );
}
