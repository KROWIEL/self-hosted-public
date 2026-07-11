import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { setupExecProxy } from './exec-proxy';
import { validateEnv } from './common/config/validate-env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  validateEnv();

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: true, credentials: true });
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
