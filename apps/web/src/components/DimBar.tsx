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
          {/* No comparison point is SAID, not rounded to zero. This rendered `▲ +0` on every
              dimension of every brand forever, because the caller passed `previous ?? score` and
              a dimension compared against itself never moves. A green up-arrow reading "+0" is
              worse than no indicator: it asserts stability that was never measured. */}
          {dim.prev === null ? (
            <span className="dimbar-nocmp" title="No earlier rollup to compare against yet">
              no prior data
            </span>
          ) : (
            <Delta value={+(dim.score - dim.prev).toFixed(1)} />
          )}
        </span>
      </div>
      <div className="dimbar-track">
        <div className="dimbar-fill" style={{ width: `${w}%`, background: col }} />
        {/* The previous-value marker is meaningless without a previous value, and drawing it at
            the current score makes it look like the score has never moved. */}
        {dim.prev !== null && (
          <div
            className="dimbar-prev"
            style={{ left: `${dim.prev}%` }}
            title={`Previous ${dim.prev}`}
          />
        )}
      </div>
    </button>
  );
}
