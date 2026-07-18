import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { setupExecProxy } from './exec-proxy';
import { validateEnv } from './common/config/validate-env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Build the CORS allowlist from env (comma-separated). We must NOT reflect an
 * arbitrary origin together with `credentials: true`, so fall back to the dev
 * web origin rather than to `true`.
 */
function corsOrigins(): string[] {
  const origins = [process.env.WEB_ORIGIN, process.env.APP_BASE_URL]
    .filter((v): v is string => !!v && v.trim() !== '')
    .flatMap((v) => v.split(','))
    .map((o) => o.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : ['http://localhost:3000'];
}

async function bootstrap() {
  validateEnv();

  // rawBody: true so GitHub webhook HMAC can verify against the exact bytes.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Baseline security headers on the API. Defaults are fine for a JSON API.
  app.use(helmet());

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: corsOrigins(), credentials: true });
  // Run provider OnModuleDestroy hooks (BullMQ workers, Redis) on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const closeExec = setupExecProxy(app);

  const port = process.env.CP_PORT ? Number(process.env.CP_PORT) : 3001;
  await app.listen(port);
  Logger.log(
    `Control plane listening on http://localhost:${port}/api/v1`,
    'Bootstrap',
  );

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      Logger.log(`${signal} received — shutting down…`, 'Bootstrap');
      closeExec();
      void app.close().then(() => process.exit(0));
    });
  }
}

void bootstrap();
