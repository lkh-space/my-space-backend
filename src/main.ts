import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule, ObserveInstrument } from './app.module.js';

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
    .addTag('PDF', 'PDF 파일 정보 검사, 암호 해제, 병합 및 분할 API')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(port);
  logger.log(`Application is running on port ${port}`, 'Bootstrap');
  logger.log(
    `Swagger UI가 활성화되었습니다: http://localhost:${port}/docs`,
    'Bootstrap',
  );
}
await bootstrap();
