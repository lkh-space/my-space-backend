import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule, ObserveInstrument } from './app.module.js';
import { VersionService } from './version/version.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;

  // Swagger (OpenAPI) 설정
  const swaggerConfig = new DocumentBuilder()
    .setTitle('My Space Backend API')
    .setDescription(
      '개인 맞춤형 유틸리티 백엔드 플랫폼 REST API 명세 및 대화형 테스트 플랫폼',
    )
    .setVersion('1.0.0')
    .addTag('System', '애플리케이션 상태 및 버전 정보 API')
    .addTag('PDF', 'PDF 파일 정보 검사, 암호 해제, 병합 및 분할 API')
    .addTag('Auth', 'Authelia SSO 기반 사용자 프로필 및 권한 정보 API')
    .addTag('Markdown Documents', '개인 마크다운 문서 생성, 조회, 수정, 삭제 및 Import/Export API')
    .addTag('Markdown Folders', '계층형 문서 폴더 관리 API')
    .addTag('Markdown Tags', '논리적 문서 태그 목록 및 통계 API')
    .addTag('Markdown Revisions', '문서 수정 이력, 버전 비교 및 복원 API')
    .addTag('Markdown Search', 'OpenSearch 기반 본문/제목/태그 풀텍스트 검색 API')
    .addTag('Markdown Assets', '마크다운 첨부 이미지 업로드 및 스트리밍 API')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // CORS 설정
  const defaultOrigins = [
    'https://my-space.homelab.local',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  const envCorsOrigins = configService.get<string[]>('app.corsOrigins') ?? [];
  const allowedOrigins = Array.from(
    new Set([...defaultOrigins, ...envCorsOrigins]),
  );

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With',
  });

  await app.listen(port);

  const versionService = app.get(VersionService);
  const versionInfo = versionService.getVersionInfo();

  logger.log(
    `Application is running on port ${port} [name=${versionInfo.name}, version=${versionInfo.version}, branch=${versionInfo.gitBranch}, commit=${versionInfo.gitCommit}, env=${versionInfo.env}]`,
    'Bootstrap',
  );
  logger.log(
    `Swagger UI가 활성화되었습니다: http://localhost:${port}/docs`,
    'Bootstrap',
  );
}
await bootstrap();
