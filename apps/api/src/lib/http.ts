import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Shared request-validation building blocks and the API's error boundary.
 *
 * Registered by `main.ts` AND by the test harness (`test/helpers/app.ts`), so every route test
 * runs behind the same error handler production does — a handler that only exists in `main.ts`
 * is one no test can see.
 */

/** A uuid. Every id in this API is one; anything else is a malformed request, not a lookup. */
export const UUID = { type: 'string', format: 'uuid' } as const;

/** `:id` params — the shape of every `/brands/:id…` and `/…/:id` route. */
export const ID_PARAMS = {
  type: 'object',
  required: ['id'],
  properties: { id: UUID },
} as const;

/** An ISO calendar date, `YYYY-MM-DD`. */
export const DATE = { type: 'string', format: 'date' } as const;

/**
 * Postgres SQLSTATEs that are the CLIENT's fault, and the status they deserve.
 *
 * Schema validation catches nearly all of these before a query runs. This is the second line:
 * if one slips through — a route whose schema missed a field — the caller still gets an honest
 * 4xx rather than a 500 that reads like an outage.
 */
const PG_CLIENT_ERRORS: Record<string, { status: number; message: string }> = {
  '22P02': { status: 400, message: 'Malformed identifier or value.' },
  '22007': { status: 400, message: 'Malformed date.' },
  '22008': { status: 400, message: 'Date out of range.' },
  '23505': { status: 409, message: 'That already exists.' },
  '23503': { status: 409, message: 'That is still referenced by something else.' },
};

/** The SQLSTATE of a Postgres error, whether raw (postgres-js) or wrapped (DrizzleQueryError). */
function pgCode(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * The error boundary.
 *
 * **A 5xx never carries the error's own message.** Fastify's default handler returns
 * `error.message` for every status, and drizzle's `DrizzleQueryError` message is
 * `Failed query: <the full SQL>\nparams: <the bound values>` — so any unhandled database error
 * handed the caller the query text, table and column names, and other tenants' ids if they were
 * bound. It is logged in full instead, with the request id, and the caller gets a generic message
 * and that id to quote.
 *
 * 4xx messages are kept: they are written for the caller (validation failures, `reply.notFound`
 * and friends) and are how a client learns what it did wrong.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const pg = pgCode(error);
  const mapped = pg ? PG_CLIENT_ERRORS[pg] : undefined;
  if (mapped) {
    request.log.warn({ err: error, sqlState: pg }, 'database rejected client input');
    return reply.status(mapped.status).send({
      statusCode: mapped.status,
      error: httpReason(mapped.status),
      message: mapped.message,
    });
  }

  const status =
    typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

  if (status < 500) {
    return reply
      .status(status)
      .send({ statusCode: status, error: httpReason(status), message: error.message });
  }

  request.log.error({ err: error }, 'unhandled error');

  /* A 5xx WE raised on purpose — `reply.serviceUnavailable('…')` and the other @fastify/sensible
     helpers, which build `http-errors` instances (`expose` is how that library marks its own
     errors). Their message is caller-facing prose written in this codebase, never an error
     object's text, so it is kept: "the assistant is unavailable because the model is not
     enabled" is the actionable answer, and replacing it with a generic one would hide it. */
  if (typeof (error as { expose?: unknown }).expose === 'boolean') {
    return reply
      .status(status)
      .send({ statusCode: status, error: httpReason(status), message: error.message });
  }

  return reply.status(status).send({
    statusCode: status,
    error: httpReason(status),
    message: `Something went wrong. Quote request id ${request.id} if you report it.`,
  });
}

function httpReason(status: number): string {
  switch (status) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 413:
      return 'Payload Too Large';
    case 415:
      return 'Unsupported Media Type';
    case 429:
      return 'Too Many Requests';
    case 503:
      return 'Service Unavailable';
    default:
      return status >= 500 ? 'Internal Server Error' : 'Error';
  }
}

/**
 * `@fastify/sensible` plus the error boundary, as one plugin.
 *
 * `fastify-plugin` so the handler applies to the whole application rather than to an
 * encapsulated child context — an error handler set inside a child is invisible to routes
 * registered beside it.
 */
export const httpBasics = fp(async (app: FastifyInstance) => {
  await app.register(sensible);
  app.setErrorHandler(errorHandler);
});
