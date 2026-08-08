import React from 'react';

export interface FabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon name. @default "robot" */
  icon?: string;
}

/**
 * The persistent assistant floating action button (bottom-right navy
 * circle). Present on every route; opens the assistant.
 */
export function Fab(props: FabProps): JSX.Element;
