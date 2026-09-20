---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-09-20
---

# 전역 에러 처리 및 커스텀 예외 체계 사양서 (Error Handling Specification)

## 1. 개요 (Summary)
NestJS 프레임워크 내장 `HttpException`에 대한 의존성을 제거하고, 비즈니스 도메인 로직과 HTTP 계층을 명확히 분리하기 위한 독자적인 커스텀 예외 체계와 전역 예외 필터(`AllExceptionsFilter`)를 정의합니다.

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* 프레임워크 독립적인 순수 TypeScript 기반 **도메인 예외 계층(`BaseDomainException`)** 수립
* 컨트롤러, 가드 등 HTTP 계층에서 명시적 상태 코드를 지정할 수 있는 **API 예외(`ApiException`)** 수립
* 모든 예외를 수신하여 일관된 클라이언트 JSON 응답 포맷으로 변환하는 **전역 예외 필터(`AllExceptionsFilter`)** 구현
* Pino 로거와 연동하여 4xx 경고 로그 및 5xx 에러 풀 스택 로그 자동 수집
* 환경(`IS_LOCAL`)에 따른 스택 트레이스(`stack`) 응답 마스킹/노출 분기

### 제외 대상 (Non-goals)
* 특정 ORM/DB 전용 예외(TypeORM, Prisma 등)의 세부 필터링 (추후 DB 도입 시 확장)

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-E01` | 도메인 서비스 | 비즈니스 제약 위반 예외 발생 | `BaseDomainException` 상속 예외를 던지며, HTTP 상태는 필터가 자동 매핑 |
| `UC-E02` | 가드 / 컨트롤러 | 클라이언트 요청 규격 오류 발생 | `ApiException`으로 명시적 HTTP 상태와 메시지 지정 발급 |
| `UC-E03` | 클라이언트 | 일관된 에러 응답 수신 | HTTP 상태 코드와 무관하게 통일된 JSON 구조의 에러 응답 수신 |
| `UC-E04` | 모니터링(Loki) | 서버 내부 장애 추적 | 500 Unhandled 에러 발생 시 Pino를 통해 단일 라인 스택 로그 자동 인덱싱 |

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-E01` (완전한 프레임워크 및 전송 계층 독립성)**: 도메인 예외는 HTTP 상태 코드(400, 404 등)나 NestJS 프레임워크 패키지에 일절 의존하지 않아야 하며, 순수 비즈니스 실패 사유를 나타내는 고유 에러 코드(`code: string`)만을 선언한다.
* **`BR-E02` (도메인 에러 코드 클라이언트 직접 노출)**: 에러 응답의 `code` 필드에는 HTTP 상태 코드 이름이 아닌, 도메인이 정의한 고유 비즈니스 에러 코드(예: `PDF_PASSWORD_PROTECTED`, `DBML_SYNTAX_ERROR`)가 그대로 반환되어야 한다.
* **`BR-E03` (전송 계층별 상태 매핑 분리 및 기본값)**: 도메인 에러 코드는 전송 계층(REST, gRPC, GraphQL)에 의존하지 않으며, 각 전송 계층의 어댑터/필터가 명시적 매핑 테이블을 통해 상태를 변환한다.
  - REST 계층에서는 `DOMAIN_ERROR_HTTP_MAP` 테이블에 등록된 에러 코드에 대응하는 HTTP 상태 코드로 변환한다.
  - 매핑 테이블에 등록되지 않은 임의의 비즈니스 에러 코드는 기본값인 `422 Unprocessable Entity`로 처리한다.
  - 향후 gRPC, GraphQL 등 다른 프로토콜 도입 시 도메인 계층 수정 없이 전송 계층 전용 매핑 어댑터만 확장한다.
* **`BR-E04` (보안 마스킹)**: 외부 서버(`IS_LOCAL=false`) 환경에서는 응답 본문에서 `stack` 정보를 원천 제외해야 한다. 로컬 개발 환경(`IS_LOCAL=true`)에서만 디버깅용 `stack`을 포함한다.
* **`BR-E05` (에러 로깅 일원화 및 상태 필터링)**: 예외 필터로 인입된 모든 예외(4xx, 5xx)는 예외 없이 `logger.error`로 기록한다. 단, 로그 페이로드에 `status`와 `statusCode` 필드를 명시하여 Loki/Grafana 모니터링 환경에서 500 이상 서버 장애를 즉시 선별 쿼리할 수 있도록 한다.

## 5. 인터페이스 및 클래스 설계 (Interface & Class Design)

### 5.1. 예외 클래스 계층

```typescript
// 1. 최상위 도메인 예외 추상 클래스 (프레임워크 무의존 순수 TS)
export abstract class BaseDomainException extends Error {
  // 비즈니스 고유 에러 코드 (예: 'PDF_PASSWORD_PROTECTED', 'DBML_SYNTAX_ERROR')
  abstract readonly code: string;

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// 2. HTTP 명시적 예외 클래스 (웹 계층 전용)
export class ApiException extends Error {
  constructor(
    public readonly statusCode: HttpStatus,
    message: string,
    public readonly code: string = 'API_ERROR',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}
```

### 5.2. 클라이언트 표준 에러 응답 DTO

```typescript
export interface ErrorResponseDto {
  statusCode: number;
  code: string;
  message: string;
  timestamp: string;
  path: string;
  details?: Record<string, unknown>;
  stack?: string; // IS_LOCAL=true 일 때만 노출
}
```

### 5.3. REST 전송 매핑 테이블 (`domain-error-http.map.ts`)

```typescript
export const DOMAIN_ERROR_HTTP_MAP: Record<string, HttpStatus> = {
  AUTH_UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  TOKEN_EXPIRED: HttpStatus.UNAUTHORIZED,
  ACCESS_DENIED: HttpStatus.FORBIDDEN,
  USER_NOT_FOUND: HttpStatus.NOT_FOUND,
  RESOURCE_NOT_FOUND: HttpStatus.NOT_FOUND,
  EMAIL_ALREADY_EXISTS: HttpStatus.CONFLICT,
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  DATABASE_CONNECTION_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

export const DEFAULT_DOMAIN_HTTP_STATUS = HttpStatus.UNPROCESSABLE_ENTITY;
```

## 6. 결정된 사항 및 오픈 질문 (Decisions & Open Questions)

* [x] **에러 응답의 `code` 필드 규격**: HTTP 상태 명칭이 아닌, 비즈니스 실패 원인을 직접 식별할 수 있는 고유 도메인 에러 코드(`code: string`, 예: `USER_NOT_FOUND`, `PDF_PASSWORD_PROTECTED`)를 그대로 반환하여 디버깅 및 Loki 로그 필터링 용이성을 확보한다.
* [x] **로깅 레벨 일원화 및 상태 필터링**: 모든 예외(4xx, 5xx)는 `logger.error`로 통일하여 기록하되, 로그 객체에 `status`/`statusCode`를 명시하여 500 이상 서버 에러를 정밀 쿼리할 수 있도록 한다.
