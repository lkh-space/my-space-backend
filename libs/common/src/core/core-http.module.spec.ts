import { describe, it, expect } from 'vitest';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { CoreHttpModule } from './core-http.module.js';
import { RemoteUserGuard } from '../guards/remote-user.guard.js';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter.js';
import { AuditLogInterceptor } from '../interceptors/audit-log.interceptor.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

describe('CoreHttpModule (BDD 단위 테스트)', () => {
  it('기본 거부 전역 가드, 전역 예외 필터, 감사 인터셉터, Zod 유효성 검증 파이프를 프로바이더로 등록해야 한다', () => {
    // given & when
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      CoreHttpModule,
    );

    // then
    expect(providers).toBeDefined();

    const guardProvider = providers.find(
      (p: { provide?: unknown }) => p?.provide === APP_GUARD,
    );
    const filterProvider = providers.find(
      (p: { provide?: unknown }) => p?.provide === APP_FILTER,
    );
    const interceptorProvider = providers.find(
      (p: { provide?: unknown }) => p?.provide === APP_INTERCEPTOR,
    );
    const pipeProvider = providers.find(
      (p: { provide?: unknown }) => p?.provide === APP_PIPE,
    );

    expect(guardProvider).toBeDefined();
    expect(guardProvider.useClass).toBe(RemoteUserGuard);

    expect(filterProvider).toBeDefined();
    expect(filterProvider.useClass).toBe(AllExceptionsFilter);

    expect(interceptorProvider).toBeDefined();
    expect(interceptorProvider.useClass).toBe(AuditLogInterceptor);

    expect(pipeProvider).toBeDefined();
    expect(pipeProvider.useClass).toBe(ZodValidationPipe);
  });
});
