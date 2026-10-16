import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { VersionService } from '@app/common';
import { AiAppModule } from './ai-app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AiAppModule, { bufferLogs: true });
  const pinoLogger = app.get(Logger);
  app.useLogger(pinoLogger);

  const configService = app.get(ConfigService);

  // Swagger UI 설정
  const swaggerConfig = new DocumentBuilder()
    .setTitle('My Space AI Workspace API')
    .setDescription(
      'J.A.R.V.I.S. Neural Core 실시간 음성 비서, Qdrant 시맨틱 검색, SSE 스트리밍 API',
    )
    .setVersion('0.1.0')
    .addTag('J.A.R.V.I.S. Voice & Neural Core', '실시간 음성/텍스트 SSE 스트리밍, 발화 인터럽트 및 오디오 서빙')
    .addTag('J.A.R.V.I.S. Neural Sessions', '신경망 스트림 세션 라이프사이클 관리')
    .addTag('AI Chat', 'Gemini / Ollama 실시간 스트리밍 대화 및 Tool 연동')
    .addTag('AI Search', 'Qdrant 벡터 기반 마크다운 문서 시맨틱 검색')
    .addTag('System', '서버 헬스체크 및 런타임 상태 진단')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

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

  // 루트 .env(PORT=3000) 상속 간섭을 방지하고, 명시된 포트 또는 AI 기본 포트 3001 우선 보장
  const port =
    process.env.PORT && process.env.PORT !== '3000'
      ? Number(process.env.PORT)
      : 3001;
  await app.listen(port);

  const versionService = app.get(VersionService);
  const versionInfo = versionService.getVersionInfo();

  pinoLogger.log(
    `[AI Workspace] Application is running on port ${port} [name=${versionInfo.name}, version=${versionInfo.version}, branch=${versionInfo.gitBranch}, commit=${versionInfo.gitCommit}, env=${versionInfo.env}] (Docs: http://localhost:${port}/docs)`,
    'Bootstrap',
  );
}

bootstrap();
