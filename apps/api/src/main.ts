import { runMigrations } from './migrate.js';
import { getEnv } from '@project-signal/config';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import authPlugin from './plugins/auth.js';
import usersRoutes from './routes/users.js';
import brandsRoutes from './routes/brands.js';
import signalsRoutes from './routes/signals.js';
import scoresRoutes from './routes/scores.js';
import { integrationsRoutes } from './routes/integrations.js';
import { aliasesRoutes } from './routes/aliases.js';
import { adminRoutes } from './routes/admin.js';
import { assistantRoutes } from './routes/assistant.js';
import { portfolioRoutes } from './routes/portfolio.js';

const HEALTH_SCHEMA = {
  response: {
    200: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        service: { type: 'string' },
      },
    },
  },
};

const app = Fastify({ logger: true });

const start = async () => {
  try {
    await app.register(sensible);

    const corsOrigins = getEnv().CORS_ORIGINS;
    await app.register(cors, {
      origin: corsOrigins ? corsOrigins.split(',').map((o) => o.trim()) : true,
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

    app.get('/health', { schema: HEALTH_SCHEMA }, async () => ({ status: 'ok', service: 'api' }));
    app.get('/ready', { schema: HEALTH_SCHEMA }, async () => ({ status: 'ok', service: 'api' }));

    await app.register(authPlugin);
    await app.register(usersRoutes);
    await app.register(brandsRoutes);
    await app.register(signalsRoutes);
    await app.register(scoresRoutes);
    await app.register(integrationsRoutes);
    await app.register(aliasesRoutes);
    await app.register(adminRoutes);
    await app.register(assistantRoutes);
    await app.register(portfolioRoutes);

    app.log.info('applying database migrations');
    await runMigrations();

    await app.listen({ port: getEnv().PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
