import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js';
import { AuditLogInterceptor } from '../interceptors/audit-log.interceptor.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

/**
 * 전역 HTTP 인프라 모듈 (CoreHttpModule)
 *
 * 모든 HTTP 기반 NestJS 애플리케이션(apps/api, apps/ai 등)에서 공통으로 적용해야 하는
 * 1) 표준 JSON 에러 필터 (AllExceptionsFilter)
 * 2) 호출자/경로/지연시간 감사 로그 인터셉터 (AuditLogInterceptor)
 * 3) Zod 스키마 기반 요청 유효성 검증 파이프 (ZodValidationPipe)
 * 를 단일 모듈로 캡슐화하여 구성 드리프트(Configuration Drift)를 원천 방지합니다.
 */
@Module({
  providers: [
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
export class CoreHttpModule {}
