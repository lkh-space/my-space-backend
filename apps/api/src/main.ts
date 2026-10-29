import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule, ObserveInstrument } from './app.module.js';
import { VersionService } from '@app/common';
import { setupSwagger } from './swagger.config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);

  // 대용량 마크다운 및 Base64 다이어그램 에셋 처리를 위한 Body Parser 용량 확장 (기본 100kb -> 300mb)
  app.useBodyParser('json', { limit: '300mb' });
  app.useBodyParser('urlencoded', { limit: '300mb', extended: true });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;

  // Swagger (OpenAPI) 문서 초기화
  const isSwaggerEnabled = setupSwagger(app);

  // CORS 설정
  const defaultOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  const rawCorsOrigins =
    configService.get<string>('CORS_ORIGINS') ??
    configService.get<string>('CORS_ORIGIN');

  const configuredOrigins = rawCorsOrigins
    ? rawCorsOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : (configService.get<string[]>('app.corsOrigins') ?? []);

  const isProduction =
    configService.get<string>('app.nodeEnv') === 'production' ||
    process.env.NODE_ENV === 'production';

  let allowedOrigins: string[];
  if (configuredOrigins.length > 0) {
    allowedOrigins = Array.from(new Set(configuredOrigins));
  } else if (!isProduction) {
    allowedOrigins = defaultOrigins;
  } else {
    allowedOrigins = [];
    logger.warn(
      '운영 환경(NODE_ENV=production)에서 CORS_ORIGINS 환경변수가 설정되지 않아 교차 출처(CORS) 요청이 모두 차단됩니다.',
      'Bootstrap',
    );
  }

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With',
  });

  app.enableShutdownHooks();

  await app.listen(port);

  const versionService = app.get(VersionService);
  const versionInfo = versionService.getVersionInfo();

  logger.log(
    `Application is running on port ${port} [name=${versionInfo.name}, version=${versionInfo.version}, branch=${versionInfo.gitBranch}, commit=${versionInfo.gitCommit}, env=${versionInfo.env}]`,
    'Bootstrap',
  );
  if (isSwaggerEnabled) {
    logger.log(
      `Swagger UI가 활성화되었습니다: http://localhost:${port}/docs`,
      'Bootstrap',
    );
  }
}
await bootstrap();
