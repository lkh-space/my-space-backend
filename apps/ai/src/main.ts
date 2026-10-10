import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AiAppModule } from './ai-app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AiAppModule, { bufferLogs: true });
  const pinoLogger = app.get(Logger);
  app.useLogger(pinoLogger);

  // Swagger UI 설정
  const swaggerConfig = new DocumentBuilder()
    .setTitle('My Space AI Workspace API')
    .setDescription(
      'J.A.R.V.I.S. Neural Core 실시간 음성 비서, Qdrant 시맨틱 검색, SSE 스트리밍 API',
    )
    .setVersion('0.0.1')
    .addTag('J.A.R.V.I.S. Voice & Neural Core', '실시간 음성/텍스트 SSE 스트리밍, 발화 인터럽트 및 오디오 서빙')
    .addTag('J.A.R.V.I.S. Neural Sessions', '신경망 스트림 세션 라이프사이클 관리')
    .addTag('AI Chat', 'Gemini / Ollama 실시간 스트리밍 대화 및 Tool 연동')
    .addTag('AI Search', 'Qdrant 벡터 기반 마크다운 문서 시맨틱 검색')
    .addTag('System', '서버 헬스체크 및 런타임 상태 진단')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // 로컬 프론트엔드 연동을 위한 CORS 활성화
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization, Remote-User, Remote-Email, Remote-Name, Remote-Groups, X-Requested-With',
  });

  // 루트 .env(PORT=3000) 상속 간섭을 방지하고, 명시된 포트 또는 AI 기본 포트 3001 우선 보장
  const port =
    process.env.PORT && process.env.PORT !== '3000'
      ? Number(process.env.PORT)
      : 3001;
  await app.listen(port);
  pinoLogger.log(`[AI Workspace] Application is running on port ${port} (Docs: http://localhost:${port}/docs)`);
}

bootstrap();
