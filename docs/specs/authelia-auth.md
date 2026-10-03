---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-03
---

# Authelia SSO Gateway 연동 및 인증 사양서 (Authelia Auth Specification)

## 1. 개요 (Summary)
홈랩 인프라의 리버스 프록시(Traefik) 및 Authelia SSO ForwardAuth 게이트웨이와 연동하여, 프록시가 주입하는 신뢰된 HTTP 헤더를 기반으로 사용자를 식별하고 감사 로깅 및 사용자 정보 조회를 제공합니다. 로컬 개발 환경에서는 번거로운 SSO 인증 절차 없이 쾌적하게 개발할 수 있도록 Mock 유저 주입(DX)을 지원합니다.

---

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* **ForwardAuth 헤더 기반 인증**: `Remote-User`, `Remote-Groups`, `Remote-Name`, `Remote-Email` 헤더 파싱 및 `req.user` 객체 바인딩
* **로컬 개발 DX 지원**: `NODE_ENV !== 'production'` 환경에서 인증 헤더가 없을 경우 Mock 유저(`local-admin`) 자동 주입
* **프로덕션 보안 방어**: 프로덕션 환경에서 `Remote-User` 누락 시 `401 Unauthorized` 예외 발생
* **`@CurrentUser()` 데코레이터 제공**: 컨트롤러 핸들러에서 안전하고 직관적인 유저 객체 주입
* **전역 감사 로그 인터셉터 (Audit Logging)**: 사용자 ID, 메서드, URL, 상태 코드, 소요 시간의 구조화 로깅
* **유저 정보 엔드포인트 제공**: `GET /api/v1/auth/me`를 통해 현재 로그인한 사용자 정보 반환

### 제외 대상 (Non-goals)
* 백엔드 자체 세션/JWT 발급 및 자체 비밀번호 로그인 (인프라 레벨의 Authelia가 전담)
* 사용자 권한/그룹 DB 저장 및 역할 관리 (추후 RBAC 도메인으로 분리)

---

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-A01` | 인증된 사용자 | 현재 사용자 정보 조회 | `GET /api/v1/auth/me` 요청 시 주입된 인증 정보를 바탕으로 자신의 프로필 반환 |
| `UC-A02` | 로컬 개발자 | 로그인 없이 로컬 API 테스트 | 로컬 환경에서 헤더 없이 요청 시 Mock 유저(`local-admin`)로 자동 통과 |
| `UC-A03` | 시스템/관리자 | 사용자 행동 추적 및 감사 | 모든 API 호출에 대해 유저 정보와 소요 시간을 구조화 로그(Pino)로 기록 |

---

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-A01` (인증 헤더 규격)**:
  - `Remote-User`: 사용자 고유 ID (필수, 예: `admin`)
  - `Remote-Groups`: 쉼표로 구분된 그룹 목록 (선택, 예: `admins,dev`)
  - `Remote-Name`: 사용자 표시명 (선택, 예: `Administrator`)
  - `Remote-Email`: 이메일 주소 (선택, 예: `admin@homelab.local`)
* **`BR-A02` (로컬 개발 환경 바이패스)**:
  - `NODE_ENV !== 'production'` 조건일 때 `Remote-User` 헤더가 존재하지 않으면 다음 Mock 유저를 주입한다:
    - `username`: `'local-admin'`
    - `displayName`: `'Local Developer'`
    - `email`: `'dev@homelab.local'`
    - `groups`: `['admins', 'dev']`
* **`BR-A03` (프로덕션 인증 검증)**:
  - `NODE_ENV === 'production'` 조건에서 `Remote-User` 헤더가 누락되었거나 빈 문자열일 경우 `401 UnauthorizedException`을 발생시킨다.
* **`BR-A04` (그룹 파싱 규칙)**:
  - `Remote-Groups` 값은 쉼표(`,`)로 분리하며 각 항목의 앞뒤 공백을 제거(trim)하고 빈 문자열을 배제한다.

---

## 5. 인터페이스 및 API 규격 (Interface / API)

### 5.1. 데이터 모델 (AuthUser)
```typescript
export interface AuthUser {
  username: string;
  displayName?: string;
  email?: string;
  groups: string[];
}
```

### 5.2. 엔드포인트: 내 정보 조회
* **Method**: `GET`
* **Path**: `/api/v1/auth/me`
* **Headers**: `Remote-User` 등 (프로덕션 필수)
* **Response**: `200 OK`
```json
{
  "username": "admin",
  "displayName": "Administrator",
  "email": "admin@homelab.local",
  "groups": ["admins", "dev"]
}
```

---

## 6. 감사 로깅 규격 (Audit Logging)
* 모든 API 요청 완료 시 다음과 같은 구조화 로그 페이로드를 기록한다:
  - `user`: `req.user?.username || 'anonymous'`
  - `method`: HTTP 메서드
  - `url`: 요청 URL
  - `statusCode`: HTTP 응답 상태 코드
  - `durationMs`: 처리 소요 시간 (ms)
* 메시지 포맷: `[AUDIT] <user> <method> <url> <statusCode> +<durationMs>ms`
