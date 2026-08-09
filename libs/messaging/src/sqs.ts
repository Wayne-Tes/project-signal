import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { getEnv } from '@project-signal/config';
import type { LogicalQueue, MessagePublisher } from './types.js';

/**
 * Resolves a logical queue to its concrete SQS queue URL.
 *
 * SQS addresses queues by URL, not by name, so unlike the Pub/Sub topic names this replaces
 * there is no sensible local-dev constant to fall back to — a URL embeds the account id and
 * region. An unset variable is therefore a hard error rather than a silent default.
 *
 * This is the AWS form of the fix for KNOWN-GAPS #7: the old code published to a hardcoded
 * constant that existed in no deployed environment, and nothing failed until the messages
 * silently went nowhere. Failing loudly at the point of use is the whole point.
 */
/**
 * Logical queue -> environment variable.
 *
 * A `Record<LogicalQueue, …>` rather than a ternary, and that is the whole point: this was
 * `logical === 'item' ? ITEM : REPORT`, so adding 'scan' to the union routed it to the REPORT
 * queue — publisher and consumer both — and nothing failed to compile. The scan queue sat empty
 * while messages piled into report, and the only reason it surfaced at all is that ingestion's
 * least-privilege IAM had no receive permission on report and said so.
 *
 * As a Record, adding a queue to `LogicalQueue` without adding it here is a type error.
 */
const QUEUE_ENV_VAR: Record<LogicalQueue, 'ITEM_QUEUE_URL' | 'REPORT_QUEUE_URL' | 'SCAN_QUEUE_URL'> =
  {
    item: 'ITEM_QUEUE_URL',
    report: 'REPORT_QUEUE_URL',
    scan: 'SCAN_QUEUE_URL',
  };

export function queueUrl(logical: LogicalQueue): string {
  const env = getEnv();
  const varName = QUEUE_ENV_VAR[logical];
  const url = env[varName];
  if (!url) {
    throw new Error(
      `${varName} must be set to use the '${logical}' queue. Terraform injects it into ` +
        `the services that publish; set it in .env (or point AWS_ENDPOINT_URL at LocalStack) ` +
        `for local development.`,
    );
  }
  return url;
}

export class SqsPublisher implements MessagePublisher {
  private readonly sqs: SQSClient;

  constructor() {
    // Credentials and region resolve through the SDK's default chain — the ECS task role in a
    // deployed environment. `AWS_ENDPOINT_URL` points at LocalStack and is unset elsewhere.
    const endpoint = process.env['AWS_ENDPOINT_URL'];
    this.sqs = new SQSClient(endpoint ? { endpoint } : {});
  }

  async publish(queue: LogicalQueue, body: string): Promise<string> {
    const res = await this.sqs.send(
      new SendMessageCommand({ QueueUrl: queueUrl(queue), MessageBody: body }),
    );
    if (!res.MessageId) {
      // Without an id we cannot claim the message was accepted. Treat it as a failure so the
      // caller's error path runs, rather than reporting a publish that may not have happened.
      throw new Error(`SQS accepted the message but returned no MessageId for '${queue}'`);
    }
    return res.MessageId;
  }
}
