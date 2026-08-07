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
export function queueUrl(logical: LogicalQueue): string {
  const env = getEnv();
  const url = logical === 'item' ? env.ITEM_QUEUE_URL : env.REPORT_QUEUE_URL;
  if (!url) {
    const varName = logical === 'item' ? 'ITEM_QUEUE_URL' : 'REPORT_QUEUE_URL';
    throw new Error(
      `${varName} must be set to publish to the '${logical}' queue. Terraform injects it into ` +
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
