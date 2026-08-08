import React from 'react';

/**
 * @startingPoint section="Core" subtitle="Base white card surface" viewport="700x200"
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Enable the hover lift (translateY(-3px) + deeper shadow). @default false */
  interactive?: boolean;
  /** A colour for a 3px top accent bar (e.g. a mosaic hue). */
  accent?: string;
  /** Inner padding. @default "20px" */
  padding?: string;
}

/**
 * The base white card surface — hairline border, soft shadow, 14px
 * radius. The container for almost all Lighthouse content.
 */
export function Card(props: CardProps): JSX.Element;
