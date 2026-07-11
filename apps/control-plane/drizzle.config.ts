import { config as loadEnv } from 'dotenv';
import type { Config } from 'drizzle-kit';

loadEnv({ path: '../../.env' });
loadEnv();

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://selfhosted:selfhosted@localhost:5432/selfhosted',
  },
} satisfies Config;
