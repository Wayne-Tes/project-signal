import React from 'react';

/**
 * @startingPoint section="Core" subtitle="Gradient initials avatar" viewport="700x120"
 */
export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Full name — first letter is used if `initial` is absent; also the tooltip. */
  name?: string;
  /** Explicit initial(s) to display. */
  initial?: string;
  /** Pixel size (square). @default 38 */
  size?: number;
  /** CSS gradient for the tile. @default blue→purple */
  gradient?: string;
  /** Corner radius in px. @default ~26% of size */
  radius?: number;
}

/**
 * A rounded-square gradient initials avatar — users, accounts, the
 * assistant lockup. Default gradient is the Tes blue→purple.
 */
export function Avatar(props: AvatarProps): JSX.Element;
