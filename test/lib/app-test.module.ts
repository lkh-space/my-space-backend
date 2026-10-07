import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
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
import { AllExceptionsFilter } from '@app/common/filters/all-exceptions.filter.js';
import { AuditLogInterceptor } from '@app/common/interceptors/audit-log.interceptor.js';
import { ZodValidationPipe } from '@app/common/pipes/zod-validation.pipe.js';
import { StorageModule } from '@app/storage/storage.module.js';
import { AppController } from '../../apps/api/src/app.controller.js';
import { AppService } from '../../apps/api/src/app.service.js';
import { PdfModule } from '../../apps/api/src/pdf/pdf.module.js';
import { AuthModule } from '../../apps/api/src/auth/auth.module.js';
import { VersionModule } from '../../apps/api/src/version/version.module.js';
import { HealthModule } from '../../apps/api/src/health/health.module.js';
import { MarkdownModule } from '../../apps/api/src/markdown/markdown.module.js';
import { TestService } from './test.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.api', '.env'],
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
    VersionModule,
    HealthModule,
    MarkdownModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    TestService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
  exports: [TestService],
})
export class AppTestModule {}
