---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-17
---

# 쿠버네티스 프로브 연동 및 런타임 진단용 헬스체크 사양서 (Health Check Specification)

## 1. 개요 (Summary)
Kubernetes(k3s) 및 인프라 오케스트레이터의 Liveness/Readiness/Startup 프로브 연동과 서버 상태 모니터링을 위해, 모노레포 내 모든 애플리케이션(`apps/api`, `apps/ai` 등)에서 공통으로 재사용 가능한 경량 헬스체크(`GET /health`) 및 의존성 심층 헬스체크(`GET /health/ready`) 엔드포인트를 공용 라이브러리(`@app/common/health`)로 제공합니다. 또한 프로세스 종료 시 우아한 종료(Graceful Shutdown)와 메시지 브로커 Drain 메커니즘을 보장합니다.

---

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* **공용 라이브러리화**: `libs/common/src/health` 모듈로 캡슐화하여, 모노레포 내 모든 앱(`apps/api`, `apps/ai`, 향후 추가 앱)에서 단 한 줄의 모듈 임포트로 Liveness 및 Readiness 프로브 API 제공
* **경량 Liveness 헬스체크 (`GET /health`)**: 외부 I/O 부하 없이 Node.js 프로세스 런타임 상태를 밀리초 단위로 점검하여 HTTP 200 OK 응답
* **심층 Readiness 헬스체크 (`GET /health/ready`)**: 현재 앱 컨테이너에 등록된 핵심 인프라(PostgreSQL Prisma `SELECT 1`, RabbitMQ 브로커 연결, MinIO 버킷 헤더, Qdrant/OpenSearch 핑)를 점검하고 하나라도 실패 시 HTTP 503 Service Unavailable 반환
* **우아한 종료 (Graceful Shutdown) 보장**: SIGTERM/SIGINT 신호 수신 시 신규 컨슈머 취소(`channel.cancel`), 처리 중인 in-flight 작업 완료 대기(최대 10초) 후 안전하게 커넥션 종료
* **Swagger 문서 일관성**: OpenAPI 명세서에 `System` 태그로 헬스체크 엔드포인트 자동 노출 및 DTO 문서화

### 제외 대상 (Non-goals)
* 개별 마이크로서비스 간의 복잡한 분산 RPC 트랜잭션 복구 (단일 인스턴스/워커 레벨의 Drain으로 한정)

---

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-H01` | Kubernetes Kubelet / 인프라 프로브 | 컨테이너 생존 상태(Liveness) 점검 | `GET /health` 호출 시 HTTP 200 OK 및 런타임 상태 수신 (API: `:3000/health`, AI: `:3001/health`) |
| `UC-H02` | 개발자 / 운영자 | 메모리 및 프로세스 가동 시간 확인 | `GET /health`를 통해 프로세스 uptime 및 메모리 사용량 실시간 확인 |
| `UC-H03` | 신규 애플리케이션 | 헬스체크 일관성 유지 | `@app/common`에서 `HealthModule`을 임포트하는 것만으로 표준 규격 헬스체크 엔드포인트 즉시 획득 |
| `UC-H04` | Kubernetes Ingress / 로드밸런서 | 트래픽 수신 가능 여부(Readiness) 점검 | `GET /health/ready` 호출 시 외부 의존성(DB, RabbitMQ 등) 상태를 진단하고 비정상 시 503 수신하여 트래픽 인입 차단 |
| `UC-H05` | 컨테이너 오케스트레이터 | 배포 및 롤링 업데이트 시 Graceful Shutdown | SIGTERM 신호 전달 시 `app.enableShutdownHooks()` 트리거, 신규 메시지 수신 즉시 차단 후 진행 중 작업 완료 대기 |

---

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-H01` (경량 무부하)**: Liveness 헬스체크(`GET /health`) 요청은 외부 I/O나 비동기 데이터베이스 쿼리를 발생시키지 않고 메모리 및 프로세스 정보만 즉각 반환해야 한다.
* **`BR-H02` (메모리 포맷 통일)**: V8 힙 메모리(`heapUsed`) 및 물리 메모리(`rss`)는 읽기 쉬운 문자열 포맷(예: `"25.4 MB"`)으로 변환하여 반환한다.
* **`BR-H03` (환경 변수 우선순위)**: `environment`는 `ConfigService`의 `app.nodeEnv` 값을 우선 조회하며, 없을 경우 `process.env.NODE_ENV`, 둘 다 없을 경우 `'development'`를 폴백으로 사용한다.
* **`BR-H04` (Readiness 진단 및 503 Fail-Closed)**:
  - Readiness 헬스체크(`GET /health/ready`)는 DiscoveryService를 통해 IoC 컨테이너에 등록된 인프라 서비스(`PrismaService`, `RabbitmqService`, `MinioService`, `OpenSearchService`, `QdrantService`)의 `checkHealth()`를 3초 타임아웃으로 실행한다.
  - 하나 이상의 서비스가 실패하거나 타임아웃 시 HTTP 503 Service Unavailable 및 `{ status: "error", checks: { ... } }`를 반환하여 로드밸런서 트래픽에서 안전하게 격리한다.
* **`BR-H05` (우아한 종료 및 메시지 드레인)**:
  - 프로세스 종료(`onModuleDestroy`) 시 `channel.cancel(consumerTag)`을 호출하여 브로커로부터 신규 메시지가 인입되는 것을 즉시 차단한다.
  - 현재 처리 중인 메시지 수(`activeMessageCount`)가 0이 될 때까지 최대 10초간 폴링 대기(Graceful Drain)한 후 채널 및 커넥션을 닫아 메시지 유실 및 중복 처리를 원천 방지한다.

---

## 5. 인터페이스 및 API 규격 (Interface / API)

### 5.1. 엔드포인트 목록
* `GET /health`: 서버 Liveness 생존 상태 및 메모리 진단
* `GET /health/ready`: 서버 Readiness 준비 상태 및 인프라 의존성 심층 진단

### 5.2. 모듈 아키텍처
* **패키지 경로**: `libs/common/src/health/`
  * `health.module.ts`: `ConfigModule`, `DiscoveryModule`을 주입받아 `HealthController`, `HealthService`를 등록하는 모듈
  * `health.controller.ts`: `GET /health`, `GET /health/ready` 핸들러 정의
  * `health.service.ts`: `DiscoveryService` 기반 런타임 인프라 서비스 탐색 및 `checkHealth()` 병렬 점검
  * `dto/health-check-response.dto.ts`: Liveness 응답 DTO
  * `dto/health-ready-response.dto.ts`: Readiness 응답 DTO
  * `index.ts`: 모듈, 서비스 및 DTO export
* **진입점**: `libs/common/src/index.ts`를 통해 `export * from './health/index.js';`로 외부에 노출

### 5.3. 요청/응답 DTO 스키마

#### 5.3.1. Liveness DTO (`HealthCheckResponseDto`)
```typescript
export class HealthCheckResponseDto {
  status: 'ok';
  timestamp: string;     // ISO 8601 일시 (예: "2026-10-17T01:45:00.000Z")
  uptime: number;        // 프로세스 가동 시간(초)
  memory: {
    heapUsed: string;    // "25.4 MB"
    rss: string;         // "65.2 MB"
  };
  environment: string;   // 실행 환경 ("production", "development", "local")
}
```

#### 5.3.2. Readiness DTO (`HealthReadyResponseDto`)
```typescript
export class ServiceCheckResultDto {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

export class HealthReadyResponseDto {
  status: 'ok' | 'error';
  timestamp: string;
  checks: Record<string, ServiceCheckResultDto>;
}
```

* **Readiness 응답 예시 (HTTP 200 OK)**:
```json
{
  "status": "ok",
  "timestamp": "2026-10-17T11:00:00.000Z",
  "checks": {
    "database": { "status": "up", "latencyMs": 3 },
    "rabbitmq": { "status": "up", "latencyMs": 1 },
    "minio": { "status": "up", "latencyMs": 12 },
    "opensearch": { "status": "up", "latencyMs": 8 }
  }
}
```

* **Readiness 실패 응답 예시 (HTTP 503 Service Unavailable)**:
```json
{
  "status": "error",
  "timestamp": "2026-10-17T11:00:00.000Z",
  "checks": {
    "database": { "status": "down", "latencyMs": 3001, "error": "database 헬스체크 타임아웃 (3초)" },
    "rabbitmq": { "status": "up", "latencyMs": 1 }
  }
}
```

---

## 6. 예외 처리 및 에러 스펙 (Error Handling)
- 경량 헬스체크(`GET /health`)는 프로세스가 기동 중인 한 항상 HTTP 200 OK를 반환합니다.
- 심층 헬스체크(`GET /health/ready`)는 하나 이상의 필수 의존성 진단 실패 시 HTTP 503 Service Unavailable 상태 코드를 반환합니다.

---

## 7. 오픈 질문 (Open Questions)
* [x] RabbitMQ 연결 상태, DB 연결 상태 등을 검사하는 심층 헬스체크(`GET /health/ready`) 구현 완료
