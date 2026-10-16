import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
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
import { createLoggerConfig } from '@app/common/logger/logger.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PdfModule } from './pdf/pdf.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule, VersionModule, CoreHttpModule } from '@app/common';
import { StorageModule } from '@app/storage/storage.module.js';
import { MarkdownModule } from './markdown/markdown.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    CoreHttpModule,
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
    VersionModule.register({ appName: 'api' }),
    HealthModule,
    MarkdownModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
