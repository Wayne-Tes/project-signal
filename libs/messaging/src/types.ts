/**
 * The two logical queues in the pipeline. Callers name the role, never the concrete queue —
 * the concrete name and URL differ per environment and come from configuration.
 */
export type LogicalQueue = 'item' | 'report';

/**
 * Publishing side of the pipeline.
 *
 * Deliberately narrow: one method, a logical queue and a string body. Everything this system
 * publishes is a signal id, and keeping the surface this small is what let the object store be
 * swapped without touching a caller — the same reasoning applies here.
 */
export interface MessagePublisher {
  /** Publishes `body` and resolves to the provider's message id. */
  publish(queue: LogicalQueue, body: string): Promise<string>;
}
