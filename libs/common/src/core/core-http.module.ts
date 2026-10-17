import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js';
import { AuditLogInterceptor } from '../interceptors/audit-log.interceptor.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';
import { RemoteUserGuard } from '../guards/remote-user.guard.js';

/**
 * 전역 HTTP 인프라 모듈 (CoreHttpModule)
 *
 * 모든 HTTP 기반 NestJS 애플리케이션(apps/api, apps/ai 등)에서 공통으로 적용해야 하는
 * 1) 기본 거부 원칙의 전역 인증 가드 (RemoteUserGuard) - @Public() 데코레이터로 예외 허용
 * 2) 표준 JSON 에러 필터 (AllExceptionsFilter)
 * 3) 호출자/경로/지연시간 감사 로그 인터셉터 (AuditLogInterceptor)
 * 4) Zod 스키마 기반 요청 유효성 검증 파이프 (ZodValidationPipe)
 * 를 단일 모듈로 캡슐화하여 구성 드리프트(Configuration Drift) 및 엔드포인트 누락 취약점을 원천 방지합니다.
 */
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: RemoteUserGuard,
    },
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
