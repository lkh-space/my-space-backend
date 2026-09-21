import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import {
  resolveDomainHttpStatus,
  DEFAULT_DOMAIN_HTTP_STATUS,
} from './domain-error-http.map.js';
import { BaseDomainException } from '../exceptions/domain.exception.js';
import { ApiException } from '../exceptions/api.exception.js';

// 테스트용 도메인 예외 구현체
class UserNotFoundException extends BaseDomainException {
  readonly code = 'USER_NOT_FOUND';
}

class DuplicateEmailException extends BaseDomainException {
  readonly code = 'EMAIL_ALREADY_EXISTS';
}

class SystemFailureException extends BaseDomainException {
  readonly code = 'DATABASE_CONNECTION_ERROR';
}

class InsufficientBalanceException extends BaseDomainException {
  readonly code = 'INSUFFICIENT_BALANCE';
}

class AccessDeniedException extends BaseDomainException {
  readonly code = 'ACCESS_DENIED';
}

class TokenExpiredException extends BaseDomainException {
  readonly code = 'TOKEN_EXPIRED';
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockLogger: PinoLogger;
  let mockRequest: Partial<Request>;
  let mockResponse: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  let mockArgumentsHost: ArgumentsHost;
  const originalEnv = process.env.IS_LOCAL;

  beforeEach(() => {
    mockLogger = {
      setContext: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as PinoLogger;

    mockRequest = {
      originalUrl: '/api/v1/test',
      method: 'POST',
      url: '/api/v1/test',
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockArgumentsHost = {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ArgumentsHost;

    filter = new AllExceptionsFilter(mockLogger);
  });

  afterEach(() => {
    process.env.IS_LOCAL = originalEnv;
    vi.clearAllMocks();
  });

  describe('resolveDomainHttpStatus (명시적 전송 매핑 테이블)', () => {
    it('등록된 도메인 에러 코드에 대해 정확한 HTTP 상태 코드를 매핑해야 한다', () => {
      // given
      const notFoundCode = 'USER_NOT_FOUND';
      const conflictCode = 'EMAIL_ALREADY_EXISTS';
      const forbiddenCode = 'ACCESS_DENIED';
      const unauthorizedCode = 'TOKEN_EXPIRED';
      const internalCode = 'DATABASE_CONNECTION_ERROR';
      const badRequestCode = 'INVALID_INPUT';

      // when
      const notFoundStatus = resolveDomainHttpStatus(notFoundCode);
      const conflictStatus = resolveDomainHttpStatus(conflictCode);
      const forbiddenStatus = resolveDomainHttpStatus(forbiddenCode);
      const unauthorizedStatus = resolveDomainHttpStatus(unauthorizedCode);
      const internalStatus = resolveDomainHttpStatus(internalCode);
      const badRequestStatus = resolveDomainHttpStatus(badRequestCode);

      // then
      expect(notFoundStatus).toBe(HttpStatus.NOT_FOUND);
      expect(conflictStatus).toBe(HttpStatus.CONFLICT);
      expect(forbiddenStatus).toBe(HttpStatus.FORBIDDEN);
      expect(unauthorizedStatus).toBe(HttpStatus.UNAUTHORIZED);
      expect(internalStatus).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(badRequestStatus).toBe(HttpStatus.BAD_REQUEST);
    });

    it('매핑 테이블에 등록되지 않은 임의의 도메인 코드는 기본값(422)을 반환해야 한다', () => {
      // given
      const unmappedCode1 = 'INSUFFICIENT_BALANCE';
      const unmappedCode2 = 'PDF_PASSWORD_PROTECTED';
      const unmappedCode3 = 'CUSTOM_BIZ_RULE_ERROR';

      // when
      const status1 = resolveDomainHttpStatus(unmappedCode1);
      const status2 = resolveDomainHttpStatus(unmappedCode2);
      const status3 = resolveDomainHttpStatus(unmappedCode3);

      // then
      expect(status1).toBe(DEFAULT_DOMAIN_HTTP_STATUS);
      expect(status2).toBe(DEFAULT_DOMAIN_HTTP_STATUS);
      expect(status3).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });
  });

  describe('ApiException 처리', () => {
    it('지정된 HTTP 상태 코드, 명시적 에러 코드 및 상세 정보를 JSON 응답으로 반환해야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new ApiException(
        HttpStatus.BAD_REQUEST,
        '잘못된 파라미터입니다.',
        'INVALID_QUERY_PARAMS',
        { field: 'title' },
      );

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'INVALID_QUERY_PARAMS',
          message: '잘못된 파라미터입니다.',
          path: '/api/v1/test',
          details: { field: 'title' },
        }),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: HttpStatus.BAD_REQUEST,
          statusCode: HttpStatus.BAD_REQUEST,
        }),
        expect.stringContaining('[POST] /api/v1/test 400'),
      );
    });

    it('code 인자를 생략하면 기본값 API_ERROR가 반환되어야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new ApiException(
        HttpStatus.BAD_REQUEST,
        '잘못된 요청입니다.',
      );

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'API_ERROR',
        }),
      );
    });
  });

  describe('BaseDomainException 처리 (도메인 에러 코드 클라이언트 반환)', () => {
    it('USER_NOT_FOUND 도메인 코드는 404 및 고유 에러 코드로 반환되어야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new UserNotFoundException('사용자를 찾을 수 없습니다.', {
        userId: '12345',
      });

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          code: 'USER_NOT_FOUND',
          message: '사용자를 찾을 수 없습니다.',
          path: '/api/v1/test',
          details: { userId: '12345' },
        }),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: HttpStatus.NOT_FOUND,
          statusCode: HttpStatus.NOT_FOUND,
        }),
        expect.any(String),
      );
    });

    it('EMAIL_ALREADY_EXISTS 도메인 코드는 409 및 고유 에러 코드로 반환되어야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new DuplicateEmailException('이미 등록된 이메일입니다.');

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.CONFLICT,
          code: 'EMAIL_ALREADY_EXISTS',
          message: '이미 등록된 이메일입니다.',
        }),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: HttpStatus.CONFLICT,
          statusCode: HttpStatus.CONFLICT,
        }),
        expect.any(String),
      );
    });

    it('DATABASE_CONNECTION_ERROR 도메인 코드는 500 및 error 레벨로 로깅되어야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new SystemFailureException('스토리지 연동 오류');

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'DATABASE_CONNECTION_ERROR',
          message: '스토리지 연동 오류',
        }),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        }),
        expect.any(String),
      );
    });

    it('매핑되지 않은 일반 비즈니스 제약 위반 코드는 422(Unprocessable Entity)로 매핑되어야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new InsufficientBalanceException('포인트가 부족합니다.');

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'INSUFFICIENT_BALANCE',
          message: '포인트가 부족합니다.',
        }),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
        expect.any(String),
      );
    });

    it('ACCESS_DENIED 도메인 코드는 403 Forbidden으로 매핑되어야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new AccessDeniedException('접근 권한이 없습니다.');

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.FORBIDDEN,
          code: 'ACCESS_DENIED',
        }),
      );
    });

    it('TOKEN_EXPIRED 도메인 코드는 401 Unauthorized로 매핑되어야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new TokenExpiredException('인증 토큰이 만료되었습니다.');

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.UNAUTHORIZED,
          code: 'TOKEN_EXPIRED',
        }),
      );
    });
  });

  describe('표준 HttpException 처리', () => {
    it('NestJS 내장 HttpException 발생 시 올바른 상태 코드와 메시지를 반환해야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new HttpException('권한이 없습니다.', HttpStatus.FORBIDDEN);

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.FORBIDDEN,
          code: 'HttpException',
          message: '권한이 없습니다.',
        }),
      );
    });
  });

  describe('미처리 Unhandled Error 처리', () => {
    it('일반 Error 발생 시 500 에러 및 error 레벨 로깅이 수행되어야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new Error('예상치 못한 데이터베이스 연결 끊김');

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'Error',
          message: '서버 내부 오류가 발생했습니다.',
        }),
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('환경별 스택 트레이스 노출 제어 (IS_LOCAL)', () => {
    it('IS_LOCAL=true 일 때는 클라이언트 응답에 stack이 포함되어야 한다', () => {
      // given
      process.env.IS_LOCAL = 'true';
      const exception = new Error('로컬 디버그 에러');

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.any(String),
        }),
      );
    });

    it('IS_LOCAL=false 일 때는 클라이언트 응답에 stack이 포함되지 않아야 한다', () => {
      // given
      process.env.IS_LOCAL = 'false';
      const exception = new Error('운영 환경 에러');

      // when
      filter.catch(exception, mockArgumentsHost);

      // then
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.not.objectContaining({
          stack: expect.anything(),
        }),
      );
    });
  });
});
