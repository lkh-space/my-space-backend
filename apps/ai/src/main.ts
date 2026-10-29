import { VersionService, setupCors } from '@app/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AiAppModule } from './ai-app.module.js';
import { setupSwagger } from './swagger.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AiAppModule, { bufferLogs: true });
  const pinoLogger = app.get(Logger);
  app.useLogger(pinoLogger);

  const configService = app.get(ConfigService);

  // Swagger (OpenAPI) 문서 초기화
  const isSwaggerEnabled = setupSwagger(app);

  // CORS 보안 정책 초기화
  setupCors(app);

  app.enableShutdownHooks();

  const port =
    configService.get<number>('app.port') ??
    (process.env.PORT ? Number(process.env.PORT) : 3001);
  await app.listen(port);

  const versionService = app.get(VersionService);
  const versionInfo = versionService.getVersionInfo();

  pinoLogger.log(
    `[AI Workspace] Application is running on port ${port} [name=${versionInfo.name}, version=${versionInfo.version}, branch=${versionInfo.gitBranch}, commit=${versionInfo.gitCommit}, env=${versionInfo.env}]`,
    'Bootstrap',
  );
  if (isSwaggerEnabled) {
    pinoLogger.log(
      `Swagger UI가 활성화되었습니다: http://localhost:${port}/docs`,
      'Bootstrap',
    );
  }
}

await bootstrap().catch((err: unknown) => {
  console.error('AI Application Bootstrap Failure:', err);
  process.exit(1);
});
