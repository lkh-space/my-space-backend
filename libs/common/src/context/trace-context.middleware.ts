import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TraceContextService } from './trace-context.service.js';
import { sanitizeRequestId } from '../logger/logger.config.js';

/**
 * 모든 HTTP 요청에 대해 검증된 x-request-id를 부여하고,
 * TraceContextService의 AsyncLocalStorage 범위 내에서 요청 파이프라인을 실행하는 미들웨어
 */
@Injectable()
export class TraceContextMiddleware implements NestMiddleware {
  constructor(private readonly traceContextService: TraceContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const rawRequestId = req.headers['x-request-id'];
    const requestId = sanitizeRequestId(rawRequestId as string | string[] | undefined);

    // 응답 헤더 및 요청 객체에 정제된 requestId 동기화
    res.setHeader('x-request-id', requestId);
    (req as Request & { id?: string }).id = requestId;

    const traceId = (req.headers['x-trace-id'] as string) || (req.headers['traceparent'] as string) || requestId;

    this.traceContextService.runWithContext(
      {
        requestId,
        traceId,
      },
      () => next(),
    );
  }
}
