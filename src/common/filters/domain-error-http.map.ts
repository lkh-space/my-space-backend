import { HttpStatus } from '@nestjs/common';

/**
 * 도메인 에러 코드와 REST HTTP 상태 코드 간 명시적 매핑 테이블
 *
 * [에이전트 및 개발자 가이드]
 * 1. 새로운 도메인 기능 개발 시 BaseDomainException을 상속받는 구체 예외(예: ResourceNotFoundException)를 정의합니다.
 * 2. 해당 예외가 404, 409, 401, 403, 500, 400 등 특정한 HTTP 상태 코드로 클라이언트에 반환되어야 한다면,
 *    반드시 아래의 DOMAIN_ERROR_HTTP_MAP에 { [에러코드]: HttpStatus } 형태로 등록하세요.
 * 3. 별도로 등록하지 않은 에러 코드는 DEFAULT_DOMAIN_HTTP_STATUS (422 Unprocessable Entity)로 자동 처리됩니다.
 *
 * [설계 배경]
 * 도메인 계층은 순수하게 비즈니스 에러 코드(`code: string`)만 정의하고 전송 계층(HTTP, gRPC, GraphQL 등)을 전혀 알지 못합니다.
 * 본 매핑 테이블은 REST API 전송 계층에서 도메인 에러 코드를 적절한 HTTP 상태 코드로 변환하는 책임을 담당합니다.
 * 향후 gRPC, GraphQL 도입 시 도메인 변경 없이 프로토콜별 어댑터/매핑만 추가하면 됩니다.
 */
export const DOMAIN_ERROR_HTTP_MAP: Record<string, HttpStatus> = {
  // 인증 및 인가 (Authelia 연동)
  AUTH_UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  TOKEN_EXPIRED: HttpStatus.UNAUTHORIZED,
  ACCESS_DENIED: HttpStatus.FORBIDDEN,
  FORBIDDEN_OPERATION: HttpStatus.FORBIDDEN,

  // 리소스 조회 실패
  RESOURCE_NOT_FOUND: HttpStatus.NOT_FOUND,

  // 충돌 및 중복
  RESOURCE_ALREADY_EXISTS: HttpStatus.CONFLICT,

  // 클라이언트 요청/입력 형식 오류
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  MALFORMED_DATA: HttpStatus.BAD_REQUEST,

  // 인프라 및 시스템 오류
  DATABASE_CONNECTION_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  EXTERNAL_API_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,

  // PDF 조작 유틸리티 도메인
  PDF_PASSWORD_REQUIRED: HttpStatus.BAD_REQUEST,
  PDF_INVALID_PASSWORD: HttpStatus.BAD_REQUEST,
  PDF_NOT_PASSWORD_PROTECTED: HttpStatus.BAD_REQUEST,
  PDF_MIN_FILE_COUNT_NOT_MET: HttpStatus.BAD_REQUEST,
  PDF_MAX_FILE_COUNT_EXCEEDED: HttpStatus.BAD_REQUEST,
  PDF_FILE_SIZE_EXCEEDED: HttpStatus.PAYLOAD_TOO_LARGE,
  PDF_INVALID_PAGE_RANGE: HttpStatus.BAD_REQUEST,
  PDF_CORRUPTED_FILE: HttpStatus.UNPROCESSABLE_ENTITY,
};

/**
 * 매핑 테이블에 등록되지 않은 도메인 에러의 기본 HTTP 상태 코드
 * 도메인 비즈니스 규칙 위반으로 간주하여 422 Unprocessable Entity를 기본값으로 사용합니다.
 */
export const DEFAULT_DOMAIN_HTTP_STATUS = HttpStatus.UNPROCESSABLE_ENTITY;

/**
 * 도메인 에러 코드를 기반으로 HTTP 상태 코드를 결정합니다.
 */
export function resolveDomainHttpStatus(code: string): HttpStatus {
  return DOMAIN_ERROR_HTTP_MAP[code] ?? DEFAULT_DOMAIN_HTTP_STATUS;
}
