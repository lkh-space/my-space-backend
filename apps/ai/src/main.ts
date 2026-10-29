import { VersionService } from '@app/common';
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

  // CORS 설정 (API 서버와 동일한 안전한 화이트리스트 및 브라우저 헤더 적용)
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
    pinoLogger.warn(
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
