import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import {
  appConfig,
  databaseConfig,
  minioConfig,
  opensearchConfig,
  qdrantConfig,
  rabbitmqConfig,
  aiConfig,
  validateEnv,
} from '@app/config/index.js';
import { StorageModule } from '@app/storage/storage.module.js';
import { AppController } from '../../apps/api/src/app.controller.js';
import { AppService } from '../../apps/api/src/app.service.js';
import { PdfModule } from '../../apps/api/src/pdf/pdf.module.js';
import { AuthModule } from '../../apps/api/src/auth/auth.module.js';
import { HealthModule, VersionModule, CoreHttpModule } from '@app/common';
import { MarkdownModule } from '../../apps/api/src/markdown/markdown.module.js';
import { TestService } from './test.service.js';

@Module({
  imports: [
    CoreHttpModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.api'],
      load: [
        appConfig,
        databaseConfig,
        minioConfig,
        opensearchConfig,
        qdrantConfig,
        rabbitmqConfig,
        aiConfig,
      ],
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: 'silent', // E2E 테스트 시 로그 노이즈 방지
      },
    }),
    StorageModule, // Prisma, MinIO, OpenSearch, RabbitMQ, Qdrant
    PdfModule,
    AuthModule,
    VersionModule.register({ appName: 'api' }),
    HealthModule,
    MarkdownModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    TestService,
  ],
  exports: [TestService],
})
export class AppTestModule {}
