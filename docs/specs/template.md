---
status: draft
owner: Keunhyeok Lim
last-updated: YYYY-MM-DD
---

# {기능/도메인 이름} 사양서 (Specification)

## 1. 개요 (Summary)
{1~2개 문장으로 이 기능이 무엇이고 왜 개발이 필요한지 정의합니다.}

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* {구현하고자 하는 핵심 요구사항 1}
* {구현하고자 하는 핵심 요구사항 2}

### 제외 대상 (Non-goals)
* {이번 범위에서 의도적으로 제외하는 기능 1}
* {추후 확장 과제로 넘기는 항목 2}

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-XX01` | 사용자 | {목표} | {주요 단계} |
| `UC-XX02` | 시스템 | {목표} | {주요 단계} |

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-XX01` ({규칙 이름})**: {규칙 내용, 유효성 검증 조건, 제약사항}
* **`BR-XX02` ({규칙 이름})**: {규칙 내용, 유효성 검증 조건, 제약사항}

## 5. 인터페이스 및 API 규격 (Interface / API)

### 5.1. 엔드포인트 목록
* `POST /api/v1/{domain}`: {설명}
* `GET /api/v1/{domain}/:id`: {설명}

### 5.2. 요청/응답 DTO 스키마

#### Request DTO
```typescript
export interface ExampleRequestDto {
  name: string;
}
```

#### Response DTO
```typescript
export interface ExampleResponseDto {
  id: string;
  name: string;
  createdAt: string;
}
```

## 6. 예외 처리 및 에러 스펙 (Error Handling)

> [!IMPORTANT]
> 새로 정의한 도메인 에러 코드가 특정 HTTP 상태 코드(404, 409, 401, 403, 500 등)로 매핑되어야 하는 경우, 구현 시 반드시 [`src/common/filters/domain-error-http.map.ts`](../../src/common/filters/domain-error-http.map.ts)의 `DOMAIN_ERROR_HTTP_MAP`에 등록해야 합니다. (미등록 시 `422 Unprocessable Entity`로 기본 처리)

| 에러 상황 | 발생 예외 클래스 | 에러 코드 (`code`) | HTTP Status | DOMAIN_ERROR_HTTP_MAP 등록 필요 여부 |
| :--- | :--- | :--- | :--- | :--- |
| {리소스 미존재} | `ResourceNotFoundException` | `RESOURCE_NOT_FOUND` | 404 Not Found | 필수 등록 |
| {접근 권한 없음} | `ForbiddenException` | `ACCESS_DENIED` | 403 Forbidden | 필수 등록 |
| {비즈니스 제약 위반} | `InvalidStateTransitionException` | `INVALID_STATE` | 422 Unprocessable Entity | 불필요 (기본값) |

## 7. 오픈 질문 (Open Questions)

* [ ] {추가 논의가 필요한 사항 1}
* [ ] {성능/인프라 측면에서 확인이 필요한 사항 2}
