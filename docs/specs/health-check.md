---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-04
---

# 쿠버네티스 프로브 연동용 헬스체크 사양서 (Health Check Specification)

## 1. 개요 (Summary)
Kubernetes(k3s) 및 인프라 오케스트레이터의 Liveness/Readiness/Startup 프로브 연동을 위해 서버의 실시간 가동 상태, 가동 시간(uptime), 메모리 점유율 및 실행 환경 정보를 제공하는 경량 헬스체크 엔드포인트(`GET /health`)를 제공합니다.

---

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* **경량 헬스체크**: 외부 부하 없이 프로세스 런타임 상태를 빠르게 점검하여 HTTP 200 OK 응답
* **런타임 메타데이터 제공**: 서버 가동 시간(`uptime`), V8 힙 및 RSS 메모리 점유 현황(`memory`), 환경 정보(`environment`) 반환
* **Swagger 문서화**: OpenAPI 명세서에 `System` 태그로 헬스체크 엔드포인트 등록
* **모듈화**: `HealthModule`로 독립 캡슐화하여 유지보수성 확보

### 제외 대상 (Non-goals)
* 외부 의존성(DB, Redis 등) 핑 검사를 포함하는 심층 헬스체크(Deep Healthcheck) (필요 시 추후 확장)

---

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-H01` | Kubernetes Kubelet / 인프라 프로브 | 컨테이너 생존 여부 점검 | `GET /health` 호출 시 HTTP 200 OK 및 런타임 통계 수신 |
| `UC-H02` | 개발자 / 운영자 | 메모리 및 프로세스 가동 시간 확인 | `GET /health`를 통해 프로세스 uptime 및 메모리 사용량 실시간 확인 |

---

## 4. 인터페이스 및 API 규격 (Interface / API)

### 4.1. 엔드포인트 목록
* `GET /health`: 서버 헬스체크 및 런타임 상태 조회

### 4.2. 요청/응답 DTO 스키마 (`HealthCheckResponseDto`)

```typescript
export class MemoryUsageDto {
  heapUsed: string; // 사용 중인 V8 힙 메모리 (예: "25.4 MB")
  rss: string;      // 프로세스 전체 물리 메모리 (예: "65.2 MB")
}

export class HealthCheckResponseDto {
  status: 'ok';
  timestamp: string;     // ISO 8601
  uptime: number;        // 프로세스 가동 시간(초)
  memory: MemoryUsageDto;
  environment: string;   // "production", "development", "local"
}
```

* **응답 예시 (HTTP 200 OK)**:
```json
{
  "status": "ok",
  "timestamp": "2026-10-04T08:15:30.123Z",
  "uptime": 3600,
  "memory": {
    "heapUsed": "25.4 MB",
    "rss": "65.2 MB"
  },
  "environment": "production"
}
```
