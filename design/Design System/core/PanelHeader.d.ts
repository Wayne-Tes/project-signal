import React from 'react';

/**
 * @startingPoint section="Core" subtitle="Light section panel header" viewport="700x110"
 */
export interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icon node shown inside the tinted tile (≈20px line icon). */
  icon?: React.ReactNode;
  /** Tint colour of the icon tile — carries the section's category colour. @default "blue" */
  tone?: 'blue' | 'lime' | 'purple' | 'teal' | 'orange' | 'magenta' | 'neutral';
  /** Panel title (Poppins 700, 16px). */
  title?: React.ReactNode;
  /** Muted one-line subtitle / meta. */
  subtitle?: React.ReactNode;
  /** Optional right-aligned action (button, link, select). */
  action?: React.ReactNode;
}

/**
 * The light panel header that replaced the old navy section bars —
 * a mosaic-tinted icon tile + title/subtitle. Sits at the top of a
 * white card; the card body follows.
 */
export function PanelHeader(props: PanelHeaderProps): JSX.Element;
