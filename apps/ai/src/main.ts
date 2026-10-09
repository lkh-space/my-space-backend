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
      '개인 맞춤형 AI Assistant, Qdrant 시맨틱 검색, RabbitMQ 비동기 인덱싱 API',
    )
    .setVersion('0.0.1')
    .addTag('AI Chat', 'Gemini / Ollama 실시간 스트리밍 대화 및 Tool 연동')
    .addTag('AI Search', 'Qdrant 벡터 기반 마크다운 문서 시맨틱 검색')
    .addTag('System', '서버 헬스체크 및 런타임 상태 진단')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  pinoLogger.log(`[AI Workspace] Application is running on port ${port} (Docs: http://localhost:${port}/docs)`);
}

bootstrap();
