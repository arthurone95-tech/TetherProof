import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Workspace scripts run from `apps/api`, so the repository-root `.env` has to
// be pointed at explicitly.
loadDotenv({ path: '../../.env' });

const connectionString = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/tetherproof';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
  },
  strict: true,
  verbose: true,
});
