import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PinoLogger } from 'nestjs-pino';
import type { Request, Response } from 'express';

/**
 * 모든 API 요청에 대해 호출 사용자, HTTP 메서드, URL, 상태 코드, 실행 소요 시간을
 * Pino 로거로 기록하는 감사(Audit) 로그 인터셉터
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AuditLogInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const start = Date.now();
    const method = request.method;
    const url = request.originalUrl || request.url;

    return next.handle().pipe(
      tap({
        next: () => {
          const user = request.user?.username || 'anonymous';
          const statusCode = response.statusCode;
          const durationMs = Date.now() - start;

          this.logger.info(
            {
              audit: true,
              user,
              method,
              url,
              statusCode,
              durationMs,
            },
            `[AUDIT] ${user} ${method} ${url} ${statusCode} +${durationMs}ms`,
          );
        },
        error: (err: unknown) => {
          const user = request.user?.username || 'anonymous';
          const statusCode =
            typeof (err as { getStatus?: () => number })?.getStatus ===
            'function'
              ? (err as { getStatus: () => number }).getStatus()
              : typeof (err as { status?: number })?.status === 'number'
                ? (err as { status: number }).status
                : 500;
          const durationMs = Date.now() - start;

          this.logger.warn(
            {
              audit: true,
              user,
              method,
              url,
              statusCode,
              durationMs,
              err: err instanceof Error ? err.message : String(err),
            },
            `[AUDIT] ${user} ${method} ${url} ${statusCode} +${durationMs}ms (failed)`,
          );
        },
      }),
    );
  }
}
