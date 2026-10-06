import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { appConfig, validateEnv } from '@app/config/index.js';
import { AllExceptionsFilter } from '@app/common/filters/all-exceptions.filter.js';
import { AppController } from '../../apps/api/src/app.controller.js';
import { AppService } from '../../apps/api/src/app.service.js';
import { PdfModule } from '../../apps/api/src/pdf/pdf.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: 'silent', // E2E 테스트 시 로그 노이즈 및 비동기 워커 스레드 충돌 방지
      },
    }),
    PdfModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppTestModule {}
