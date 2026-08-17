import { getLlmClient, getReporterModel } from '@project-signal/llm';
import type { JsonSchema } from '@project-signal/llm';
import type { Play } from '@project-signal/playbook';

/**
 * Adapting a matched play to one cluster's actual evidence.
 *
 * ## What the model is and is not allowed to do
 *
 * It rewrites the wording of steps that already exist, in the language of the specific complaints,
 * and it summarises what people actually said. That is all.
 *
 * It does **not** invent interventions, and it does **not** produce evidence. Both were considered
 * and both are refused, for the same reason: a model asked "what did others do about this" answers
 * fluently, with a company, a percentage and a date, none of which can be checked. This repository
 * has already shipped a retired model id, one that never existed, and a fictional bank's roadmap
 * with invented uplifts. Those were cheap to fix. A fabricated case study reaching a client is not.
 *
 * ## The constraint is enforced in code, not asked for in the prompt
 *
 * A prompt saying "do not invent steps" is a request. `adaptedSteps` is therefore truncated to the
 * original step count, and any step the model adds beyond it is discarded rather than trusted. The
 * play's `measure`, `owner`, `horizon` and `evidence` are never sent to the model at all — it
 * cannot alter what it has not been given.
 *
 * ## Failure is not fatal
 *
 * Adaptation is a nicety on top of a play that already stands on its own. If the model is
 * unavailable, refuses, or returns something unusable, the caller keeps the curated wording. An
 * outage must not empty the roadmap.
 */

export interface AdaptedPlay {
  /** The play's steps, rewritten for this cluster. Never longer than the original. */
  adaptedSteps: string[];
  /** What the signals actually say, in two sentences. Grounded in the text supplied. */
  whatPeopleAreSaying: string;
  /** The model that produced it, for the audit trail. */
  modelVersion: string;
}

const ADAPT_SCHEMA = {
  type: 'object',
  properties: {
    adaptedSteps: {
      type: 'array',
      description:
        'The SAME steps, rewritten to name the specific product, platform and complaint in the evidence. Same order, same count. Do not add, remove, merge or reorder steps.',
      items: { type: 'string' },
    },
    whatPeopleAreSaying: {
      type: 'string',
      description:
        'Two sentences summarising the complaints in the supplied signals. Use only what is in them. Do not estimate numbers, name companies that are not mentioned, or refer to studies.',
    },
  },
  required: ['adaptedSteps', 'whatPeopleAreSaying'],
} satisfies JsonSchema;

export const ADAPT_PROMPT = (play: Play, topic: string, verbatims: string[]): string => `You are helping a marketing team act on customer feedback.

They have a subject called "${topic}" and a chosen course of action. Your ONLY job is to rewrite that action's steps so they name the specific product, platform and complaint the evidence shows — and to summarise what people are saying.

THE ACTION (do not change what it is, only how it is worded):
${play.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

WHAT PEOPLE ACTUALLY SAID (${verbatims.length} example${verbatims.length === 1 ? '' : 's'}):
${verbatims.map((v) => `- ${v}`).join('\n')}

Rules, all of them absolute:
- Return exactly ${play.steps.length} steps, in the same order, meaning the same things.
- Do not invent a new step, merge two, or drop one.
- Do not cite research, studies, benchmarks, industry averages or other companies. You have not been given any and you must not supply them.
- Do not estimate results, percentages, timeframes or costs.
- Use only what appears in the evidence above. If it does not say something, do not say it either.
- Keep each step to one sentence a manager could put in a meeting invitation.`;

/**
 * The most verbatim text sent to the model.
 *
 * Enough to be representative, bounded so one very long article cannot dominate the prompt or the
 * cost. Adaptation is a per-action nicety, not a per-signal pipeline.
 */
export const MAX_VERBATIMS = 8;
export const MAX_VERBATIM_CHARS = 600;

export async function adaptPlay(
  play: Play,
  topic: string,
  verbatims: string[],
): Promise<AdaptedPlay | null> {
  const sample = verbatims
    .filter((v) => v && v.trim().length > 0)
    .slice(0, MAX_VERBATIMS)
    .map((v) => v.slice(0, MAX_VERBATIM_CHARS).replace(/\s+/g, ' ').trim());

  /* Nothing to ground it in means nothing to adapt from. Asking the model to personalise a play
     with no evidence in front of it is an invitation to invent the evidence. */
  if (sample.length === 0) return null;

  const model = getReporterModel();

  try {
    const result = await getLlmClient().structured<Omit<AdaptedPlay, 'modelVersion'>>({
      model,
      prompt: ADAPT_PROMPT(play, topic, sample),
      name: 'adapt_play',
      description: 'Rewrites an existing action’s steps in the language of specific evidence.',
      schema: ADAPT_SCHEMA,
    });

    const steps = (result.adaptedSteps ?? [])
      .filter((s) => typeof s === 'string' && s.trim().length > 0)
      /* TRUNCATED, NOT TRUSTED. The prompt asks for the same count; this guarantees it. A model
         that adds a step has invented an intervention, which is the one thing it must not do. */
      .slice(0, play.steps.length)
      .map((s) => s.trim());

    /* Fewer steps than the play has means something was dropped, and a silently shortened plan is
       worse than the curated one. Fall back rather than ship a partial action. */
    if (steps.length !== play.steps.length) return null;

    return {
      adaptedSteps: steps,
      whatPeopleAreSaying: (result.whatPeopleAreSaying ?? '').trim(),
      modelVersion: model,
    };
  } catch {
    /* Deliberately swallowed. Adaptation sits on top of a play that already stands alone, and an
       LLM outage must not empty the roadmap. The caller keeps the curated wording. */
    return null;
  }
}
