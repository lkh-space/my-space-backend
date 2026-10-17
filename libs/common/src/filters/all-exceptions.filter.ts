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
 * 클라이언트 반환 표준 에러 응답 규격 DTO (RFC 7807 Problem Details 호환)
 */
export interface ErrorResponseDto {
  // RFC 7807 표준 필드
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;

  // 프로젝트 표준 확장 필드
  code: string;
  traceId?: string;
  timestamp: string;
  details?: Record<string, unknown>;
  stack?: string;

  // 레거시 필드 (기존 클라이언트 및 E2E 테스트 호환성 유지)
  statusCode: number;
  message: string;
  path: string;
}

function getHttpStatusTitle(status: HttpStatus): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'Bad Request';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Not Found';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'Unprocessable Entity';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'Payload Too Large';
    case HttpStatus.INTERNAL_SERVER_ERROR:
      return 'Internal Server Error';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'Service Unavailable';
    case HttpStatus.BAD_GATEWAY:
      return 'Bad Gateway';
    default:
      return 'Error';
  }
}

/**
 * 전역 예외 처리 필터 (AllExceptionsFilter)
 * 애플리케이션의 모든 예외(ApiException, BaseDomainException, HttpException, Error)를 가로채어
 * RFC 7807(Problem Details) 표준 JSON 에러 응답을 반환하고 로깅합니다.
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
    const rawTraceId =
      request?.headers?.['x-request-id'] ||
      request?.headers?.['traceparent'] ||
      request?.headers?.['x-trace-id'];
    const traceId = typeof rawTraceId === 'string' ? rawTraceId : undefined;

    // 예외 필터로 들어온 모든 에러는 error 레벨로 로깅
    const logPayload = {
      status,
      statusCode: status,
      code,
      path,
      method,
      traceId,
      details,
      err: exception instanceof Error ? exception : undefined,
    };

    this.logger.error(logPayload, `[${method}] ${path} ${status} - ${message}`);

    const errorResponse: ErrorResponseDto = {
      type: `https://api.myspace.local/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title: getHttpStatusTitle(status),
      status,
      code,
      detail: message,
      instance: path,
      ...(traceId && { traceId }),
      timestamp: new Date().toISOString(),
      ...(details && { details }),
      ...(isLocal && stack && { stack }),

      // 레거시 호환 필드
      statusCode: status,
      message,
      path,
    };

    response
      .status(status)
      .setHeader('Content-Type', 'application/problem+json')
      .json(errorResponse);
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
        const { message: _m, statusCode: _s, error: _e, ...rest } = resObj;
        if (Object.keys(rest).length > 0) {
          details = rest;
        }
      }


      return { status, code, message, details };
    }

    // Multer 직접 예외 방어 (NestJS transformException 누락 시 또는 원본 MulterError 유입 시)
    if (
      exception instanceof Error &&
      (exception.name === 'MulterError' ||
        ('code' in exception &&
          typeof (exception as { code?: unknown }).code === 'string' &&
          (exception as { code: string }).code.startsWith('LIMIT_')))
    ) {
      const multerCode = (exception as { code?: string }).code;
      if (multerCode === 'LIMIT_FILE_SIZE') {
        return {
          status: HttpStatus.PAYLOAD_TOO_LARGE,
          code: 'PAYLOAD_TOO_LARGE',
          message: exception.message || '업로드 파일 크기 제한을 초과했습니다.',
        };
      }
      return {
        status: HttpStatus.BAD_REQUEST,
        code: multerCode || 'BAD_REQUEST',
        message: exception.message || '잘못된 파일 업로드 요청입니다.',
      };
    }

    // Prisma Client Known Request Errors 처리 (P2002: Unique constraint violation -> 409, P2025: Record not found -> 404)
    if (
      exception instanceof Error &&
      (exception.name === 'PrismaClientKnownRequestError' ||
        (exception.constructor &&
          exception.constructor.name === 'PrismaClientKnownRequestError'))
    ) {
      const prismaCode = (exception as unknown as { code?: string }).code;
      const details = (exception as unknown as { meta?: Record<string, unknown> })
        .meta;

      if (prismaCode === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          code: 'DATABASE_UNIQUE_CONFLICT',
          message:
            '데이터베이스 고유 제약 조건(Unique Constraint)을 위반하여 요청을 처리할 수 없습니다.',
          details,
        };
      }

      if (prismaCode === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'DATABASE_RECORD_NOT_FOUND',
          message: '대상 데이터베이스 레코드를 찾을 수 없습니다.',
          details,
        };
      }
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
