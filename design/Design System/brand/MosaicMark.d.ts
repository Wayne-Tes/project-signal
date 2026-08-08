import React from 'react';

declare module 'react' {}

/**
 * @startingPoint section="Brand" subtitle="3×3 mosaic brand mark" viewport="320x160"
 */
export interface MosaicMarkProps extends React.SVGProps<SVGSVGElement> {
  /** Pixel size of the square mark. @default 32 */
  size?: number;
  /** Gap between tiles in px. @default ~8.5% of size */
  gap?: number;
  /** Corner radius of each tile in px. @default ~28% of tile */
  radius?: number;
}

/**
 * The Lighthouse brand mosaic mark (3×3 rounded squares).
 */
export function MosaicMark(props: MosaicMarkProps): JSX.Element;
