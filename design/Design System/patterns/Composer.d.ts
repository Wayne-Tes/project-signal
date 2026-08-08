import React from 'react';

export interface ComposerSuggestion {
  label: string;
  /** Icon name from the Icon set. */
  icon?: string;
}

/**
 * @startingPoint section="Patterns" subtitle="Ask Lighthouse composer" viewport="820x320"
 */
export interface ComposerProps {
  /** Input placeholder. */
  placeholder?: string;
  /** Suggestion chips shown below the input. */
  suggestions?: ComposerSuggestion[];
  /** Follow-up chips shown after a reply. */
  followups?: string[];
  /** `(query) => string` — produces the (streamed) reply text. */
  answer?: (query: string) => string;
  /** Called with the submitted text (wire to a real endpoint). */
  onSubmit?: (query: string) => void;
  /** Initial for the echoed-question avatar. @default "D" */
  userInitial?: string;
}

/**
 * The "Ask Lighthouse" composer — mosaic-gradient-bordered input, navy
 * send button, suggestion chips, and a streamed response card with a
 * blinking caret and follow-up chips. The hero of Home and Chat.
 */
export function Composer(props: ComposerProps): JSX.Element;
