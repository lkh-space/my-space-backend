---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-22
---

# 환경 설정 및 ConfigService 사양서 (Configuration Specification)

## 1. 개요 (Summary)
애플리케이션 전반의 환경변수(`process.env`) 직접 참조를 지양하고, **Zod**와 `@nestjs/config`를 결합한 공용 설정 라이브러리(`libs/config`)를 통해 모노레포 내 모든 애플리케이션(`apps/api`, `apps/ai`)에서 타입 안전하고 모듈화된 환경 설정 관리 체계를 수립합니다.

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* **Zod 기반 런타임 스키마 검증 (`validateEnv`)**: 잘못된 환경변수 값이나 필수 형식 위반 시 애플리케이션 시작 시점에 즉시 기동 실패(Fail-fast) 처리
* **모듈별 네임스페이스(`registerAs`) 분리**:
  - `app`: 서버 포트, 구동 환경, 로컬 여부, 로그 레벨, CORS 허용 출처, 프록시 시크릿
  - `database`: PostgreSQL 연결 URL 및 호스트/포트/계정 설정
  - `minio`: S3 호환 오브젝트 스토리지 엔드포인트, 인증키, 문서/에셋 버킷명
  - `opensearch`: 전문 검색 엔진 노드, 인증 정보, 인덱스명
  - `qdrant`: 시맨틱 벡터 DB URL, API 키, 컬렉션명
  - `rabbitmq`: 메시지 브로커 URL 및 마크다운 인덱싱 큐 이름
  - `ai`: Google Gemini 및 Ollama 모델/임베딩 기본값 단일 관리(SSOT)
* **앱별 `.env` 분리 및 Fallback 지원**: `apps/api`는 `['.env.api', '.env']`, `apps/ai`는 `['.env.ai', '.env']` 순서로 로드하여 앱별 격리와 로컬 단일 `.env` 편의성을 동시에 달성
* **운영 배포 환경 호환**: 컨테이너 환경(Kubernetes, Docker)에서 주입되는 시스템 환경변수 완벽 지원

### 제외 대상 (Non-goals)
* 외부 원격 설정 저장소(AWS Secrets Manager, HashiCorp Vault 등) 실시간 폴링 (추후 필요 시 확장)

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-C01` | 서버 런타임 | 환경변수 로드 및 검증 | 부트스트랩 시 `.env.<app>`, `.env` 및 시스템 환경변수를 Zod로 검증 후 ConfigModule 초기화 |
| `UC-C02` | 개발자 | 잘못된 환경변수 감지 | 올바르지 않은 값 입력 시 명확한 Zod 검증 에러 메시지와 함께 기동 중단 |
| `UC-C03` | 서비스 / 모듈 | 타입 안전한 설정 주입 | `@Inject(aiConfig.KEY)` 또는 `ConfigService`를 통해 타입 안정성이 보장된 설정값 사용 |
| `UC-C04` | 로거 모듈 | 설정 기반 로거 초기화 | `ConfigService`를 통해 `app.isLocal`, `app.logLevel`을 비동기로 주입받아 Pino 로거 구성 |

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-C01` (환경변수 직접 참조 지양 및 SSOT 유지)**: 비즈니스 로직과 인프라 서비스는 `libs/config`에 정의된 네임스페이스 설정(`appConfig`, `aiConfig`, `databaseConfig`, `minioConfig`, `opensearchConfig`, `qdrantConfig`, `rabbitmqConfig`)을 통해 설정값을 주입받는다.
* **`BR-C02` (핵심 기본값 및 타입 강제)**:
  - `PORT`: 숫자형 (기본값: `3000`, 1~65535 범위)
  - `NODE_ENV`: `'development'` | `'production'` | `'test'` (기본값: `'development'`)
  - `IS_LOCAL`: 불리언 문자열 파싱 (`'true'` -> `true`, 기본값: `false`)
  - `LOG_LEVEL`: `'debug'` | `'info'` | `'warn'` | `'error'` (기본값: `isLocal ? 'debug' : 'info'`)
  - `GEMINI_MODEL`: 기본값 `'gemini-3.8-flash'`, `GEMINI_EMBEDDING_MODEL`: 기본값 `'gemini-embedding-001'`
  - `OLLAMA_MODEL`: 기본값 `'qwen3.5:0.8b'`, `OLLAMA_EMBEDDING_MODEL`: 기본값 `'nomic-embed-text'`
* **`BR-C03` (Fail-Fast 검증)**: 환경변수 검증에 실패할 경우 자세한 필드 에러 내역을 출력하고 프로세스 기동을 즉시 중단한다.
* **`BR-C04` (모듈 네임스페이스 독립성)**: 각 도메인 설정은 `libs/config/src/` 하위에 `registerAs`를 통해 고유 키로 격리한다.

## 5. 인터페이스 및 Zod 스키마 설계 (`libs/config`)

* **환경변수 스키마 정의**: [`libs/config/src/env.validation.ts`](../../libs/config/src/env.validation.ts)
* **네임스페이스 설정 파일**:
  - [`libs/config/src/app.config.ts`](../../libs/config/src/app.config.ts)
  - [`libs/config/src/database.config.ts`](../../libs/config/src/database.config.ts)
  - [`libs/config/src/minio.config.ts`](../../libs/config/src/minio.config.ts)
  - [`libs/config/src/opensearch.config.ts`](../../libs/config/src/opensearch.config.ts)
  - [`libs/config/src/qdrant.config.ts`](../../libs/config/src/qdrant.config.ts)
  - [`libs/config/src/rabbitmq.config.ts`](../../libs/config/src/rabbitmq.config.ts)
  - [`libs/config/src/ai.config.ts`](../../libs/config/src/ai.config.ts)

## 6. 예외 처리 및 에러 스펙 (Error Handling)

| 에러 상황 | 발생 위치 | 동작 결과 |
| :--- | :--- | :--- |
| `PORT`, `DATABASE_PORT`, `MINIO_PORT`에 숫자가 아닌 문자열 입력 | `validateEnv` (Zod) | 에러 필드와 사유 출력 후 앱 부트스트랩 즉시 중단 |
| `NODE_ENV`, `LOG_LEVEL`에 허용되지 않은 값 입력 | `validateEnv` (Zod) | 허용 enum 목록 출력 후 앱 부트스트랩 즉시 중단 |

## 7. 결정된 사항 (Decisions)

* [x] **Zod 채택**: 간결한 스키마 정의 및 완벽한 TypeScript 추론을 위해 Zod를 사용.
* [x] **앱별 환경 파일(`.env.api`, `.env.ai`) 및 공통 `.env` 병행 지원**: 모노레포 앱 분리 환경과 로컬 단일 파일 DX를 모두 만족하도록 배열(`envFilePath: ['.env.api', '.env']`) 형태로 로드.
