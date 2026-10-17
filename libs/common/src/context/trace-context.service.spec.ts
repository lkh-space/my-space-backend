import { describe, it, expect, vi } from 'vitest';
import { TraceContextService } from './trace-context.service.js';
import { TraceContextMiddleware } from './trace-context.middleware.js';
import type { Request, Response } from 'express';

describe('TraceContextService & TraceContextMiddleware (BDD 단위 테스트)', () => {
  describe('TraceContextService', () => {
    it('runWithContext 범위 내에서 비동기 I/O를 거쳐도 동일한 requestId와 traceId를 유지한다', async () => {
      // given
      const service = new TraceContextService();
      const testContext = {
        requestId: 'req-test-1234',
        traceId: 'trace-parent-5678',
        userId: 'test-user',
      };

      // when & then
      await service.runWithContext(testContext, async () => {
        expect(service.getRequestId()).toBe('req-test-1234');
        expect(service.getTraceId()).toBe('trace-parent-5678');
        expect(service.getContext()).toEqual(testContext);

        // 비동기 지연 작업 후에도 컨텍스트 보존 확인
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(service.getRequestId()).toBe('req-test-1234');

        // 컨텍스트 병합 확인
        service.setContext({ customFlag: true });
        expect(service.getContext()?.customFlag).toBe(true);
      });

      // 컨텍스트 범위 밖에서는 undefined
      expect(service.getRequestId()).toBeUndefined();
      expect(service.getContext()).toBeUndefined();
    });

    it('동시에 실행되는 서로 다른 비동기 요청 간 컨텍스트가 완벽히 격리된다', async () => {
      // given
      const service = new TraceContextService();

      // when
      const promise1 = service.runWithContext({ requestId: 'req-alpha' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return service.getRequestId();
      });

      const promise2 = service.runWithContext({ requestId: 'req-beta' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return service.getRequestId();
      });

      const [res1, res2] = await Promise.all([promise1, promise2]);

      // then
      expect(res1).toBe('req-alpha');
      expect(res2).toBe('req-beta');
    });
  });

  describe('TraceContextMiddleware', () => {
    it('요청 헤더의 x-request-id를 검증하여 컨텍스트에 설정하고 응답 헤더에 동기화한다', () => {
      // given
      const service = new TraceContextService();
      const middleware = new TraceContextMiddleware(service);

      const mockReq = {
        headers: {
          'x-request-id': 'valid-client-req-id',
        },
      } as unknown as Request;

      const mockRes = {
        setHeader: vi.fn(),
      } as unknown as Response;

      const mockNext = vi.fn(() => {
        expect(service.getRequestId()).toBe('valid-client-req-id');
      });

      // when
      middleware.use(mockReq, mockRes, mockNext);

      // then
      expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', 'valid-client-req-id');
      expect(mockNext).toHaveBeenCalled();
    });

    it('악의적인 x-request-id가 들어오면 정제된 새 UUID로 교체하여 컨텍스트를 구성한다', () => {
      // given
      const service = new TraceContextService();
      const middleware = new TraceContextMiddleware(service);

      const mockReq = {
        headers: {
          'x-request-id': 'invalid\r\n[CRITICAL] Log Injection',
        },
      } as unknown as Request;

      const mockRes = {
        setHeader: vi.fn(),
      } as unknown as Response;

      let capturedRequestId: string | undefined;
      const mockNext = vi.fn(() => {
        capturedRequestId = service.getRequestId();
      });

      // when
      middleware.use(mockReq, mockRes, mockNext);

      // then
      expect(capturedRequestId).toBeDefined();
      expect(capturedRequestId).not.toContain('\r');
      expect(capturedRequestId).not.toContain('\n');
      expect(mockRes.setHeader).toHaveBeenCalledWith('x-request-id', capturedRequestId);
    });
  });
});
