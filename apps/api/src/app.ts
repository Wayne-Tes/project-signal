import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { getEnv } from '@project-signal/config';
import authPlugin from './plugins/auth.js';
import { httpBasics } from './lib/http.js';
import { registerRateLimit } from './lib/rate-limit.js';
import { healthRoutes } from './routes/health.js';
import { localAuthRoutes } from './routes/local-auth.js';
import usersRoutes from './routes/users.js';
import brandsRoutes from './routes/brands.js';
import signalsRoutes from './routes/signals.js';
import scoresRoutes from './routes/scores.js';
import roadmapRoutes from './routes/roadmap.js';
import crmRoutes from './routes/crm.js';
import voiceRoutes from './routes/voice.js';
import changeRoutes from './routes/change.js';
import { integrationsRoutes } from './routes/integrations.js';
import { aliasesRoutes } from './routes/aliases.js';
import { adminRoutes } from './routes/admin.js';
import backfillRoutes from './routes/backfill.js';
import { assistantRoutes } from './routes/assistant.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { scanRoutes } from './routes/scans.js';

/**
 * The whole API, wired exactly as it runs — every plugin, in production order.
 *
 * Separate from `main.ts` (which adds migrations and `listen`) so the real-Postgres integration
 * suite (`test/integration`) exercises THIS function rather than a hand-assembled copy of it. A
 * copy is how a test passes against wiring production does not have: a missing error handler,
 * a rate limiter registered before auth, a route never registered at all.
 */
export async function buildApp(
  options: FastifyServerOptions = { logger: true },
): Promise<FastifyInstance> {
  // Fails here on any invalid environment — including AUTH_MODE=local with NODE_ENV=production.
  const env = getEnv();
  const app = Fastify(options);

  // @fastify/sensible + the error boundary that keeps 5xx details out of responses.
  await app.register(httpBasics);

  await app.register(cors, {
    origin: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map((o) => o.trim()) : true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Project Signal API', version: '1.0.0' },
      components: {
        securitySchemes: {
          BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(authPlugin);
  // After auth: the limiter keys on request.user, which auth sets. See lib/rate-limit.ts.
  await registerRateLimit(app);

  await app.register(healthRoutes);
  // Registers nothing unless AUTH_MODE=local.
  await app.register(localAuthRoutes);
  await app.register(usersRoutes);
  await app.register(brandsRoutes);
  await app.register(signalsRoutes);
  await app.register(scoresRoutes);
  await app.register(changeRoutes);
  await app.register(roadmapRoutes);
  await app.register(crmRoutes);
  await app.register(voiceRoutes);
  await app.register(integrationsRoutes);
  await app.register(aliasesRoutes);
  await app.register(adminRoutes);
  await app.register(backfillRoutes);
  await app.register(assistantRoutes);
  await app.register(portfolioRoutes);
  await app.register(scanRoutes);

  if (env.AUTH_MODE === 'local') {
    app.log.warn(
      'AUTH_MODE=local: unsigned dev tokens are accepted and POST /auth/local/sign-in is enabled. Developer machines only.',
    );
  }

  return app;
}
