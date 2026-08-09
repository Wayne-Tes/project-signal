import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { queueUrl } from './sqs.js';
import type { LogicalQueue } from './types.js';

/**
 * The SQS consumer — the link that was never built.
 *
 * Ingestion published signal ids to SQS from the day the AWS port landed, and **nothing ever
 * read them**. A grep of the whole repository for `ReceiveMessage` returned zero hits: the
 * sentiment worker exposed only `/health` and `/ready`. So the pipeline stopped dead at the
 * queue — signals were collected, published, and never scored. Everything downstream (dimension
 * scores, Brand impact, the index itself) was therefore permanently empty in any deployed
 * environment, for reasons no dashboard could show.
 *
 * DESIGN NOTES, each of which is a way this goes wrong if done casually:
 *
 * **Long polling, not a spin loop.** `WaitTimeSeconds: 20` means an idle queue costs one request
 * every twenty seconds rather than thousands. Short polling on an empty queue is a bill for
 * nothing and, worse, can miss messages because it samples only a subset of SQS hosts.
 *
 * **Delete only after the handler succeeds.** A message deleted on receipt is a message lost the
 * moment the handler throws. Leaving it to reappear after the visibility timeout is what makes
 * a transient failure retryable, and what eventually feeds the dead-letter queue that already
 * exists in Terraform and has never received anything.
 *
 * **A permanent failure must still delete.** A payload that will never parse should not be
 * redelivered until the redrive policy gives up; that is a fixed number of retries spent to
 * reach a conclusion already known on the first attempt. The handler signals this by resolving
 * rather than throwing — see the sentiment worker's PermanentScoringError.
 *
 * **One message at a time per batch iteration, sequentially.** Concurrency here would multiply
 * Bedrock calls without bound, and the scorer is the expensive part. Throughput is scaled by
 * running more tasks, which ECS can do and a `Promise.all` inside one task cannot do safely.
 */

export interface ConsumerOptions {
  /** Logical queue name, resolved to a URL from the environment. */
  queue: LogicalQueue;
  /** Called once per message body. Throwing marks the message for retry. */
  handle: (body: string) => Promise<void>;
  /** Messages per receive call. SQS caps this at 10. */
  batchSize?: number;
  /** Long-poll duration. SQS caps this at 20. */
  waitTimeSeconds?: number;
  /**
   * Pause after an empty receive, in milliseconds.
   *
   * Normally zero, because long polling already blocks for up to 20 seconds. It exists because
   * the loop MUST yield to the event loop on every iteration: if a receive ever returns
   * immediately — a misconfigured wait time, a stubbed client — a tight while-loop starves
   * everything else in the process, including the timer that would have stopped it. It did
   * exactly that the first time this was tested, and killed the worker.
   */
  idleDelayMs?: number;
  /**
   * Pause after a FAILED receive, in milliseconds.
   *
   * Stops a persistent queue or network error becoming a hot loop against the SQS API. Slept in
   * short slices rather than one long await, so a shutdown does not have to wait it out — a task
   * being drained by ECS should stop promptly, not five seconds later.
   */
  errorBackoffMs?: number;
  /** Called for anything that escapes the handler, so a host can log it its own way. */
  onError?: (error: unknown, body: string) => void;
}

export class SqsConsumer {
  private readonly client: SQSClient;
  private running = false;
  /** Resolves once the loop has actually exited, so shutdown can wait for it. */
  private stopped: Promise<void> = Promise.resolve();

  constructor(private readonly options: ConsumerOptions) {
    const endpoint = process.env['AWS_ENDPOINT_URL'];
    this.client = new SQSClient(endpoint ? { endpoint } : {});
  }

  /** True while the polling loop is active. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Starts polling. Returns immediately; the loop runs until `stop()`.
   *
   * The URL is resolved HERE rather than in the constructor so that a misconfigured queue fails
   * at start-up, where it is visible, instead of on the first message hours later.
   */
  start(): void {
    if (this.running) return;
    const url = queueUrl(this.options.queue);
    this.running = true;
    this.stopped = this.loop(url);
  }

  /** Stops after the current receive completes, and waits for the loop to exit. */
  async stop(): Promise<void> {
    this.running = false;
    await this.stopped;
  }

  private async loop(url: string): Promise<void> {
    const {
      handle,
      batchSize = 10,
      waitTimeSeconds = 20,
      idleDelayMs = 0,
      errorBackoffMs = 5_000,
      onError = (err, body) => console.error(`Message failed, leaving for retry: ${body}`, err),
    } = this.options;

    while (this.running) {
      let messages: Message[] = [];
      try {
        const res = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: url,
            MaxNumberOfMessages: Math.min(batchSize, 10),
            WaitTimeSeconds: Math.min(waitTimeSeconds, 20),
          }),
        );
        messages = res.Messages ?? [];
      } catch (err) {
        /* A receive failure is the queue or the network, not this message. Log and continue —
           throwing here would kill the loop and silently stop the entire pipeline, which is
           precisely the failure this class exists to end. The sleep stops a persistent error
           becoming a hot loop against the SQS API. */
        onError(err, '<receive>');
        await this.backoff(errorBackoffMs);
        continue;
      }

      for (const message of messages) {
        if (!this.running) break;
        const body = message.Body ?? '';
        try {
          await handle(body);
          /* Success. Delete, so it is not redelivered. */
          await this.delete(url, message);
        } catch (err) {
          /* Left undeleted deliberately: it reappears after the visibility timeout and, after
             the redrive policy's attempts, lands in the DLQ. */
          onError(err, body);
        }
      }

      /* Always yield, even at zero. `await sleep(0)` defers through the timer queue, which is
         what lets stop() take effect and what stops an instantly-returning receive from becoming
         a hot loop. */
      if (messages.length === 0) await sleep(idleDelayMs);
    }
  }

  /** Sleeps in slices so `stop()` is not blocked waiting out a backoff. */
  private async backoff(totalMs: number): Promise<void> {
    const slice = 50;
    for (let waited = 0; waited < totalMs && this.running; waited += slice) {
      await sleep(Math.min(slice, totalMs - waited));
    }
  }

  private async delete(url: string, message: Message): Promise<void> {
    if (!message.ReceiptHandle) return;
    try {
      await this.client.send(
        new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle }),
      );
    } catch (err) {
      /* The work is already done and committed. A failed delete means one redelivery and one
         duplicate attempt, which every handler here is idempotent against — far better than
         treating it as a processing failure and redoing the expensive part. */
      console.error('Could not delete message after successful handling', err);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
