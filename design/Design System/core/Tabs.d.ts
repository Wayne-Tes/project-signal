import React from 'react';

export interface TabItem {
  id: string;
  label: React.ReactNode;
}

/**
 * @startingPoint section="Core" subtitle="Underline tab bar" viewport="700x120"
 */
export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Tabs to render — strings or {id,label} objects. */
  tabs: Array<string | TabItem>;
  /** The active tab id. */
  value: string;
  /** Called with the new tab id. */
  onChange?: (id: string) => void;
}

/**
 * Underline tab bar — switches content in place (Overview/Analytics,
 * Inbox/Archive/Snoozed, My/Shared/Discover).
 */
export function Tabs(props: TabsProps): JSX.Element;
