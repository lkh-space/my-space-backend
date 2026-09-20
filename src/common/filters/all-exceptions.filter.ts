import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { BaseDomainException } from '../exceptions/domain.exception.js';
import { ApiException } from '../exceptions/api.exception.js';
import { checkIsLocal } from '../logger/logger.config.js';
import { resolveDomainHttpStatus } from './domain-error-http.map.js';

/**
 * 클라이언트 반환 표준 에러 응답 규격 DTO
 */
export interface ErrorResponseDto {
  statusCode: number;
  code: string;
  message: string;
  timestamp: string;
  path: string;
  details?: Record<string, unknown>;
  stack?: string;
}

/**
 * 전역 예외 처리 필터 (AllExceptionsFilter)
 * 애플리케이션의 모든 예외(ApiException, BaseDomainException, HttpException, Error)를 가로채어
 * 표준화된 JSON 에러 응답을 클라이언트에 반환하고, Pino 로거를 통해 로깅합니다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const isLocal = checkIsLocal();
    const { status, code, message, details } = this.resolveErrorInfo(
      exception,
      isLocal,
    );

    const stack = exception instanceof Error ? exception.stack : undefined;
    const path = request?.originalUrl || request?.url || '';
    const method = request?.method || '';

    // 예외 필터로 들어온 모든 에러는 error 레벨로 로깅
    // Loki/Grafana에서 500 이상 서버 에러만 필터링할 수 있도록 status/statusCode 필드 제공
    const logPayload = {
      status,
      statusCode: status,
      code,
      path,
      method,
      details,
      err: exception instanceof Error ? exception : undefined,
    };

    this.logger.error(logPayload, `[${method}] ${path} ${status} - ${message}`);

    const errorResponse: ErrorResponseDto = {
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path,
      ...(details && { details }),
      ...(isLocal && stack && { stack }),
    };

    response.status(status).json(errorResponse);
  }

  /**
   * 발생한 예외 객체를 분석하여 정규화된 에러 정보(HTTP 상태, 에러 코드, 메시지, 상세)를 추출합니다.
   */
  private resolveErrorInfo(
    exception: unknown,
    isLocal: boolean,
  ): {
    status: HttpStatus;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof ApiException) {
      return {
        status: exception.statusCode,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof BaseDomainException) {
      return {
        status: resolveDomainHttpStatus(exception.code),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = exception.name;
      const res = exception.getResponse();

      let message = exception.message;
      let details: Record<string, unknown> | undefined;

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string) || exception.message;
        details = resObj;
      }

      return { status, code, message, details };
    }

    if (exception instanceof Error) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: exception.name || 'INTERNAL_SERVER_ERROR',
        message: isLocal ? exception.message : '서버 내부 오류가 발생했습니다.',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
    };
  }
}
