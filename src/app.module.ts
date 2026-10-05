import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { LoggerModule } from 'nestjs-pino';
import {
  appConfig,
  databaseConfig,
  minioConfig,
  opensearchConfig,
  validateEnv,
} from './config/index.js';
import { createLoggerConfig } from './common/logger/logger.config.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PdfModule } from './pdf/pdf.module.js';
import { AuthModule } from './auth/auth.module.js';
import { VersionModule } from './version/version.module.js';
import { HealthModule } from './health/health.module.js';
import { StorageModule } from './storage/storage.module.js';
import { MarkdownModule } from './markdown/markdown.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, minioConfig, opensearchConfig],
      validate: validateEnv,
    }),
    StorageModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isLocal = configService.get<boolean>('app.isLocal', false);
        const logLevel = configService.get<string>(
          'app.logLevel',
          isLocal ? 'debug' : 'info',
        );
        return createLoggerConfig({ isLocal, logLevel });
      },
    }),
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'my-space-backend',
    }),
    PdfModule,
    AuthModule,
    VersionModule,
    HealthModule,
    MarkdownModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
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
})
export class AppModule {}
