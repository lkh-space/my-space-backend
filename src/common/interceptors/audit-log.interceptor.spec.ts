import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, CallHandler, HttpException, HttpStatus } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';
import type { Request, Response } from 'express';
import { AuditLogInterceptor } from './audit-log.interceptor.js';

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let logger: PinoLogger;

  beforeEach(() => {
    logger = {
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as PinoLogger;

    interceptor = new AuditLogInterceptor(logger);
  });

  const createMockContext = (
    reqPartial: Partial<Request> = {},
    statusCode = 200,
  ): ExecutionContext => {
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/auth/me',
      user: { username: 'test-user' },
      ...reqPartial,
    } as Request;

    const response = {
      statusCode,
    } as Response;

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  };

  it('요청 성공 시 사용자 정보, URL, 상태 코드, 소요 시간을 logger.info로 기록한다', async () => {
    // given
    const context = createMockContext({
      method: 'POST',
      originalUrl: '/api/v1/pdf/merge',
      user: { username: 'admin' },
    }, 200);

    const callHandler: CallHandler = {
      handle: () => of({ success: true }),
    };

    // when
    const result$ = interceptor.intercept(context, callHandler);
    const result = await lastValueFrom(result$);

    // then
    expect(result).toEqual({ success: true });
    expect(logger.info).toHaveBeenCalledTimes(1);

    const [payload, message] = vi.mocked(logger.info).mock.calls[0];
    expect(payload).toMatchObject({
      audit: true,
      user: 'admin',
      method: 'POST',
      url: '/api/v1/pdf/merge',
      statusCode: 200,
    });
    expect(typeof (payload as { durationMs: number }).durationMs).toBe('number');
    expect(message).toContain('[AUDIT] admin POST /api/v1/pdf/merge 200');
  });

  it('인증되지 않은 유저 요청인 경우 user를 anonymous로 기록한다', async () => {
    // given
    const context = createMockContext({
      user: undefined,
      originalUrl: '/api/v1/public/ping',
    });

    const callHandler: CallHandler = {
      handle: () => of('pong'),
    };

    // when
    const result$ = interceptor.intercept(context, callHandler);
    await lastValueFrom(result$);

    // then
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [payload] = vi.mocked(logger.info).mock.calls[0];
    expect(payload).toMatchObject({
      user: 'anonymous',
    });
  });

  it('요청 실패(에러 발생) 시 logger.warn으로 에러 및 상태 코드를 기록한다', async () => {
    // given
    const context = createMockContext({
      user: { username: 'bad-actor' },
      originalUrl: '/api/v1/secure',
    });

    const error = new HttpException('Access Denied', HttpStatus.FORBIDDEN);
    const callHandler: CallHandler = {
      handle: () => throwError(() => error),
    };

    // when & then
    const result$ = interceptor.intercept(context, callHandler);
    await expect(lastValueFrom(result$)).rejects.toThrow(error);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [payload, message] = vi.mocked(logger.warn).mock.calls[0];
    expect(payload).toMatchObject({
      audit: true,
      user: 'bad-actor',
      method: 'GET',
      url: '/api/v1/secure',
      statusCode: 403,
      err: 'Access Denied',
    });
    expect(message).toContain('[AUDIT] bad-actor GET /api/v1/secure 403');
  });
});
