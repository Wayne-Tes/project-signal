import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Schema is the shared contract in libs/db; the API owns the generated migrations.
  schema: '../../libs/db/src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL']!,
  },
  verbose: true,
  strict: true,
});
