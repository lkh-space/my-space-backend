---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-03
---

# 애플리케이션 버전 및 빌드 메타데이터 사양서 (Version Info Specification)

## 1. 개요 (Summary)
서비스에 배포된 애플리케이션의 버전(`package.json`), Git 브랜치명, 커밋 해시, 빌드 시각 및 런타임 환경 정보를 확인하고 검증할 수 있는 시스템 엔드포인트(`GET /version`, `GET /api/v1/version`)를 제공합니다. 향후 다중 서비스(NestJS 모노레포) 확장을 고려하여 각 애플리케이션 식별자(`name`)를 함께 제공하며 독립 모듈로 설계합니다.

---

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* **애플리케이션 메타데이터 식별**: `package.json`의 `name` 및 `version`을 런타임에 안전하게 로드하고 제공
* **Git 형상 추적**: 배포된 코드의 Git 브랜치(`gitBranch`) 및 커밋 해시(`gitCommit`) 노출
* **하이브리드 Git 정보 수집**:
  * **프로덕션(Docker 배포)**: GitHub Actions 빌드 시점의 `build-arg`로 주입받은 환경변수(`GIT_COMMIT`, `GIT_BRANCH`, `BUILD_TIME`) 활용
  * **로컬 개발 환경 (`IS_LOCAL=true`)**: 로컬 `.git` 디렉토리로부터 `git rev-parse` 명령을 실행하여 실시간 브랜치 및 커밋 해시 자동 취득
* **이중 라우트 지원**: 쿠버네티스/인프라 및 간이 호출용 `/version`과 API 게이트웨이 표준 규격 `/api/v1/version` 동시 매핑
* **부팅 시점 로깅**: 애플리케이션 기동 시 버전 및 커밋 정보를 Pino 로거로 출력하여 Loki 및 콘솔에서 즉시 확인 가능하도록 지원
* **모노레포 대비 모듈화**: `VersionModule`을 독립 구성하여 향후 `apps/` 및 `libs/`로 쉽게 이전 가능한 구조 확립

### 제외 대상 (Non-goals)
* 외부 의존성(DB, Redis 등) 연결 상태를 점검하는 심층 헬스체크(Deep Healthcheck) (추후 `terminus` 모듈 등으로 별도 분리)
* 패키지 버전 자동 범프 및 배포 승인 제어 (CI/CD 파이프라인 영역)

---

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-V01` | 개발자 / 운영자 | 배포된 애플리케이션 버전 및 Git 형상 확인 | `GET /version` 또는 `GET /api/v1/version` 호출 시 앱 이름, 버전, 브랜치, 커밋 해시, 빌드 시간, 환경 정보 수신 |
| `UC-V02` | 로컬 개발자 | 로컬 작업 중 현재 브랜치/커밋 확인 | 로컬에서 별도 환경변수 설정 없이도 현재 작업 중인 브랜치와 HEAD 커밋 해시 자동 반영 확인 |
| `UC-V03` | 모니터링 시스템 (Loki) | 서버 기동 시점의 버전 감사 로그 확인 | 앱 부트스트랩 완료 시 출력되는 버전/커밋 단일 라인 로그를 통해 배포 이력 추적 |

---

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-V01` (애플리케이션 메타데이터 로드)**:
  - `name`: 환경변수 `APP_NAME`이 지정되어 있으면 우선 적용하고, 미지정 시 `package.json`의 `name` 필드를 사용한다. (기본값: `'my-space-backend'`)
  - `version`: 환경변수 `APP_VERSION`이 지정되어 있으면 우선 적용하고, 미지정 시 `package.json`의 `version` 필드를 사용한다. (기본값: `'0.0.1'`)
* **`BR-V02` (Git 커밋 및 브랜치 취득 우선순위)**:
  - 1순위: 환경변수 `GIT_COMMIT`, `GIT_BRANCH`가 존재하면 해당 값을 사용한다.
  - 2순위: 환경변수가 없고 로컬 개발 환경(`IS_LOCAL=true` 또는 `NODE_ENV !== 'production'`)인 경우, `git rev-parse --abbrev-ref HEAD` 및 `git rev-parse --short HEAD` 명령으로 실시간 조회한다.
  - 3순위: 명령 실패 또는 프로덕션 무주입 상태인 경우 `'unknown'`으로 폴백한다.
* **`BR-V03` (빌드 일시 및 런타임 환경)**:
  - `buildTime`: 환경변수 `BUILD_TIME`이 존재하면 사용하고, 없으면 애플리케이션 기동 시점의 ISO 8601 타임스탬프를 사용한다.
  - `env`: `process.env.NODE_ENV ?? (process.env.IS_LOCAL === 'true' ? 'local' : 'development')`
* **`BR-V04` (결과 캐싱)**:
  - 애플리케이션 런타임 동안 메타데이터가 반복 평가되어 오버헤드를 일으키지 않도록, `VersionService` 인스턴스 초기화 시 1회 평가 후 인메모리 캐싱하여 반환한다.

---

## 5. 인터페이스 및 API 규격 (Interface / API)

### 5.1. 엔드포인트 목록
* `GET /version`: 루트 레벨 버전 조회 엔드포인트
* `GET /api/v1/version`: API v1 표준 경로 버전 조회 엔드포인트

### 5.2. 요청/응답 DTO 스키마

#### Response DTO (`VersionResponseDto`)
```typescript
export interface VersionResponseDto {
  name: string;        // 애플리케이션 명 (예: "my-space-backend")
  version: string;     // SemVer 앱 버전 (예: "0.0.1")
  gitBranch: string;   // Git 브랜치명 (예: "main", "feature/version-api")
  gitCommit: string;   // Git 커밋 해시 (예: "c334cc2")
  buildTime: string;   // 빌드 일시 (ISO 8601)
  env: string;         // 구동 환경 (예: "production", "local")
}
```

* **응답 예시 (HTTP 200 OK)**:
```json
{
  "name": "my-space-backend",
  "version": "0.0.1",
  "gitBranch": "main",
  "gitCommit": "c334cc2",
  "buildTime": "2026-10-03T16:45:00.000Z",
  "env": "production"
}
```

---

## 6. 예외 처리 및 에러 스펙 (Error Handling)
본 엔드포인트는 항상 안전하게 기본값(`'unknown'`)으로 폴백하도록 설계되어 `500 InternalServerError`를 발생시키지 않고 항상 `200 OK`를 보장합니다.

---

## 7. 오픈 질문 (Open Questions)
* [x] **모노레포 다중 앱 대응**: `name`과 `version`을 환경변수 및 각 패키지 단위로 오버라이드할 수 있도록 파라미터화하여 모노레포 전환 시 완벽 호환
* [x] **Git 없는 도커 컨테이너 문제**: Docker BuildKit의 `build-arg`를 통해 CI 빌드 시점에 환경변수로 영구 주입하여 해결
