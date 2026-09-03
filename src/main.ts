import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from '@config/env';
import { DomainExceptionFilter } from '@interface/http/shared/domain-exception.filter';
import { JsonLogger } from '@infrastructure/observability/json-logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new JsonLogger(),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());

  app.enableShutdownHooks();

  await app.listen(env.httpPort);
  Logger.log(`Wagering processor ouvindo na porta ${env.httpPort}`, 'Bootstrap');
}

void bootstrap();
