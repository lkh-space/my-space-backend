---
status: draft
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

* **`BR-E01` (프레임워크 예외 분리)**: 도메인 서비스 및 순수 비즈니스 로직 클래스에서는 NestJS의 `HttpException` 계열(`BadRequestException` 등)을 직접 임포트하거나 던져서는 안 된다.
* **`BR-E02` (도메인 예외 코드 매핑)**: `BaseDomainException`의 `code`는 다음 표준 HTTP Status로 자동 변환된다:
  - `NOT_FOUND` ➔ `404 Not Found`
  - `BAD_REQUEST` ➔ `400 Bad Request`
  - `UNAUTHORIZED` ➔ `401 Unauthorized`
  - `FORBIDDEN` ➔ `403 Forbidden`
  - `CONFLICT` ➔ `409 Conflict`
  - `INTERNAL` ➔ `500 Internal Server Error`
* **`BR-E03` (보안 마스킹)**: 외부 서버(`IS_LOCAL=false`) 환경에서는 응답 본문에서 `stack` 정보를 원천 제외해야 한다. 로컬 개발 환경(`IS_LOCAL=true`)에서만 디버깅용 `stack`을 포함한다.
* **`BR-E04` (로깅 차등화)**: 4xx 클라이언트 예외는 `logger.warn`, 5xx 서버 예외 및 미처리 런타임 오류는 `logger.error`로 로깅한다.

## 5. 인터페이스 및 클래스 설계 (Interface & Class Design)

### 5.1. 예외 클래스 계층

```typescript
// 1. 도메인 예외 코드
export enum DomainErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  INTERNAL = 'INTERNAL',
}

// 2. 최상위 도메인 예외 추상 클래스
export abstract class BaseDomainException extends Error {
  abstract readonly code: DomainErrorCode;

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

// 3. HTTP 명시적 예외 클래스
export class ApiException extends Error {
  constructor(
    public readonly statusCode: HttpStatus,
    message: string,
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

## 6. 오픈 질문 (Open Questions)

* [ ] 에러 응답의 `code` 필드 값으로 구체적인 예외 클래스명(예: `UserNotFoundException`)을 사용할지, 아니면 도메인 에러 코드(예: `USER_NOT_FOUND`)를 사용할지?
* [ ] 4xx 클라이언트 오류 발생 시 Pino 로거의 레벨을 `warn`으로 남길 것인가, `info` 또는 `debug`로 남길 것인가?
