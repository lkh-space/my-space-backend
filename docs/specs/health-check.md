---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-09
---

# 쿠버네티스 프로브 연동 및 런타임 진단용 헬스체크 사양서 (Health Check Specification)

## 1. 개요 (Summary)
Kubernetes(k3s) 및 인프라 오케스트레이터의 Liveness/Readiness/Startup 프로브 연동과 서버 상태 모니터링을 위해, 모노레포 내 모든 애플리케이션(`apps/api`, `apps/ai` 등)에서 공통으로 재사용 가능한 경량 헬스체크 엔드포인트(`GET /health`)를 공용 라이브러리(`@app/common/health`)로 제공합니다.

---

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* **공용 라이브러리화**: `libs/common/src/health` 모듈로 캡슐화하여, 모노레포 내 모든 앱(`apps/api`, `apps/ai`, 향후 추가 앱)에서 단 한 줄의 모듈 임포트로 헬스체크 API 제공
* **경량 헬스체크**: 외부 DB/네트워크 부하 없이 Node.js 프로세스 런타임 상태를 밀리초 단위로 점검하여 HTTP 200 OK 응답
* **런타임 메타데이터 제공**: 서버 가동 시간(`uptime`), V8 힙 및 RSS 메모리 점유 현황(`memory`), 실행 환경 정보(`environment`) 반환
* **Swagger 문서 일관성**: OpenAPI 명세서에 `System` 태그로 헬스체크 엔드포인트 자동 노출 및 DTO 문서화

### 제외 대상 (Non-goals)
* 외부 의존성(PostgreSQL, Qdrant, MinIO, RabbitMQ 등) 핑 검사를 포함하는 무거운 심층 헬스체크(Deep Healthcheck) (필요 시 별도 엔드포인트 또는 추후 단계에서 확장)

---

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-H01` | Kubernetes Kubelet / 인프라 프로브 | 컨테이너 생존 및 준비 상태 점검 | `GET /health` 호출 시 HTTP 200 OK 및 런타임 상태 수신 (API: `:3000/health`, AI: `:3001/health`) |
| `UC-H02` | 개발자 / 운영자 | 메모리 및 프로세스 가동 시간 확인 | `GET /health`를 통해 프로세스 uptime 및 메모리 사용량 실시간 확인 |
| `UC-H03` | 신규 애플리케이션 | 헬스체크 일관성 유지 | `@app/common`에서 `HealthModule`을 임포트하는 것만으로 표준 규격 헬스체크 엔드포인트 즉시 획득 |

---

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-H01` (경량 무부하)**: 헬스체크 요청은 외부 I/O나 비동기 데이터베이스 쿼리를 발생시키지 않고 메모리 및 프로세스 정보만 즉각 반환해야 한다.
* **`BR-H02` (메모리 포맷 통일)**: V8 힙 메모리(`heapUsed`) 및 물리 메모리(`rss`)는 읽기 쉬운 문자열 포맷(예: `"25.4 MB"`)으로 변환하여 반환한다.
* **`BR-H03` (환경 변수 우선순위)**: `environment`는 `ConfigService`의 `app.nodeEnv` 값을 우선 조회하며, 없을 경우 `process.env.NODE_ENV`, 둘 다 없을 경우 `'development'`를 폴백으로 사용한다.

---

## 5. 인터페이스 및 API 규격 (Interface / API)

### 5.1. 엔드포인트 목록
* `GET /health`: 서버 헬스체크 및 런타임 상태 조회

### 5.2. 모듈 아키텍처
* **패키지 경로**: `libs/common/src/health/`
  * `health.module.ts`: `ConfigModule`을 주입받아 `HealthController`를 등록하는 모듈
  * `health.controller.ts`: `GET /health` 핸들러 정의
  * `dto/health-check-response.dto.ts`: Swagger 데코레이터가 적용된 응답 DTO
  * `index.ts`: 모듈 및 DTO export
* **진입점**: `libs/common/src/index.ts`를 통해 `export * from './health/index.js';`로 외부에 노출

### 5.3. 요청/응답 DTO 스키마 (`HealthCheckResponseDto`)

```typescript
export class MemoryUsageDto {
  heapUsed: string; // 사용 중인 V8 힙 메모리 (예: "25.4 MB")
  rss: string;      // 프로세스 전체 물리 메모리 (RSS, 예: "65.2 MB")
}

export class HealthCheckResponseDto {
  status: 'ok';
  timestamp: string;     // ISO 8601 일시 (예: "2026-10-09T01:45:00.000Z")
  uptime: number;        // 프로세스 가동 시간(초)
  memory: MemoryUsageDto;
  environment: string;   // 실행 환경 ("production", "development", "local")
}
```

* **응답 예시 (HTTP 200 OK)**:
```json
{
  "status": "ok",
  "timestamp": "2026-10-09T01:45:00.000Z",
  "uptime": 3600,
  "memory": {
    "heapUsed": "25.4 MB",
    "rss": "65.2 MB"
  },
  "environment": "development"
}
```

---

## 6. 예외 처리 및 에러 스펙 (Error Handling)
경량 헬스체크는 프로세스 내부 메모리/업타임 상태만을 조회하므로, 프로세스가 실행 중인 한 항상 HTTP 200 OK를 반환합니다. 별도의 도메인 에러 코드는 발생하지 않습니다.

---

## 7. 오픈 질문 (Open Questions)
* [ ] 향후 RabbitMQ 연결 상태, DB 연결 상태 등을 검사하는 심층 헬스체크(`GET /health/deep` 또는 `GET /health/ready`)의 필요성 여부 (현재는 경량 프로브 전용으로 충분)
