# My Space Backend (`my-space-backend`)

> **개인 맞춤형 유틸리티 백엔드 플랫폼 (NestJS 모노레포)**  
> 개발자 개인이 일상 및 업무에서 사용하는 PDF 조작, 마크다운 지식 베이스, 그리고 AI Workspace(RAG & Tool Calling)를 외부 상용 서비스에 의존하지 않고 높은 자유도와 보안성을 갖추어 직접 호스팅하는 백엔드 공간입니다.

---

## 1. 아키텍처 개요 (Monorepo Architecture)

본 프로젝트는 **Nest CLI 표준 모노레포(`apps/`, `libs/`)** 아키텍처를 채택하여 비즈니스 유틸리티 API와 AI 연산 서비스를 독립적인 프로세스로 격리 운영합니다.

```text
my-space-backend/
├── apps/
│   ├── api/                           # 메인 백엔드 REST API 서버 (포트 3000)
│   │   ├── src/auth/                  # Authelia SSO 사용자 프로필 연동
│   │   ├── src/health/                # K8s Liveness/Readiness 헬스체크
│   │   ├── src/markdown/              # 마크다운 문서/폴더/태그/리비전/검색/에셋 관리
│   │   ├── src/pdf/                   # PDF 검사/암호해제/병합/범위분할
│   │   └── src/version/               # Git 브랜치, 커밋 해시 메타데이터
│   └── ai/                            # AI Workspace 독립 서비스 (포트 3001)
│       ├── src/chat/                  # 단발성 대화 & SSE 실시간 스트리밍 엔드포인트
│       ├── src/indexing/              # RabbitMQ 비동기 마크다운 인덱싱 워커
│       ├── src/providers/             # Gemini 3.8 Flash & Ollama (qwen3.5:0.8b) Provider
│       ├── src/search/                # Qdrant 기반 768차원 시맨틱 벡터 검색
│       ├── src/tools/                 # AI Tool Calling 3종 (검색/열람/마크다운저장)
│       └── src/utils/                 # 헤딩/코드블록 보존 마크다운 청커
├── libs/                              # 공유 도메인 및 스토리지 라이브러리
│   ├── common/                        # 인증 가드, 데코레이터, 전역 예외 필터, Pino 로거
│   ├── config/                        # Zod 환경변수 검증 및 도메인별 Config 네임스페이스
│   └── storage/                       # Prisma, MinIO, OpenSearch, Qdrant, RabbitMQ 연동
├── docs/
│   ├── adr/                           # 아키텍처 의사결정 기록 (MADR 4.0.0)
│   └── specs/                         # 도메인별 SDD 기능 사양서 (Single Source of Truth)
└── .github/workflows/                 # CI/CD 및 GitOps 자동 배포 워크플로우
```

---

## 2. 기술 스택 및 연동 인프라

| 영역 | 기술 스택 / 도구 | 상세 설명 |
| :--- | :--- | :--- |
| **Framework** | NestJS v12 (Native ESM) | Node.js v24 (`"type": "module"`), NodeNext 모듈 해석 |
| **Language** | TypeScript v6.x | Nest CLI 컴파일러 API 호환성 유지 |
| **Package Manager** | pnpm v12.x | Corepack 연동, Native ESM Subpath Imports (`#common/*`, `#storage/*`, `#config/*`) |
| **Testing & Lint** | Vitest v4.x, oxlint | 초고속 BDD 단위/E2E 테스트 및 정적 분석 |
| **Primary Database** | PostgreSQL, Prisma ORM | 마크다운 메타데이터, 계층 폴더, 태그, 리비전 이력 |
| **Object Storage** | MinIO (S3 호환) | 마크다운 원본 본문(`.md`), 첨부 이미지 에셋, PDF 임시 파일 |
| **Search Engines** | OpenSearch & Qdrant | 제목/본문/태그 풀텍스트 검색(OpenSearch) & 768차원 시맨틱 벡터 검색(Qdrant) |
| **Message Queue** | RabbitMQ | 문서 생성/수정/삭제 시 AI 인덱싱 큐(`markdown-indexing-queue`) 비동기 발행 |
| **AI Providers** | Google Gemini & Ollama | `gemini-3.8-flash` / `text-embedding-004` (운영), `qwen3.5:0.8b` (로컬) |
| **Authentication** | Authelia Forward Auth | Reverse Proxy HTTP 헤더(`Remote-User`, `Remote-Groups` 등) 기반 사용자 격리 |

---

## 3. 실행 및 개발 명령어 (`package.json` Scripts)

모든 애플리케이션 명령어는 `api`와 `ai` 네임스페이스로 명확하게 분리되어 있습니다.

### 3.1 개발 서버 실행

```bash
# API 서버 로컬 개발 실행 (포트 3000, 파일 감시, 로컬 Mock 인증 활성화)
$ pnpm run start:api:dev

# AI Workspace 서버 로컬 개발 실행 (포트 3001, 파일 감시, 로컬 Mock 인증 활성화)
$ pnpm run start:ai:dev

# 디버그 모드 실행
$ pnpm run start:api:debug
$ pnpm run start:ai:debug
```

### 3.2 빌드 및 프로덕션 실행

```bash
# 전체 모노레포 빌드 (apps/api 및 apps/ai 동시 컴파일)
$ pnpm run build

# 개별 애플리케이션 빌드
$ pnpm run build:api
$ pnpm run build:ai

# 프로덕션 실행
$ pnpm run start:api:prod       # node dist/apps/api/main.js
$ pnpm run start:ai:prod        # node dist/apps/ai/main.js
```

### 3.3 코드 검증 및 테스트

```bash
# 정적 분석 (oxlint)
$ pnpm run lint

# 코드 포맷팅 (prettier)
$ pnpm run format

# 전체 단위 테스트 실행 (Vitest 158개 테스트)
$ pnpm run test

# 테스트 감시 모드
$ pnpm run test:watch

# 테스트 커버리지 리포트
$ pnpm run test:cov

# E2E 테스트 실행
$ pnpm run test:e2e
```

---

## 4. 환경 변수 설정 (`.env.api`, `.env.ai`)

애플리케이션별로 환경 변수 파일이 분리되어 있습니다. 예제 템플릿을 복사하여 환경 변수를 구성합니다:

```bash
# API 서버 환경 변수
$ cp .env.api.example .env.api

# AI Workspace 서버 환경 변수
$ cp .env.ai.example .env.ai
```

> [!NOTE]
> 각 애플리케이션(`apps/api`, `apps/ai`)은 기동 시 `.env.api` 및 `.env.ai`를 우선 로드하며, 공통 로컬 개발을 위해 단일 `.env` 파일이 존재할 경우 fallback으로 자동 병합 참조합니다.

---

## 5. Swagger API 문서

각 서버 구동 후 브라우저에서 대화형 Swagger 문서를 확인할 수 있습니다:

- **메인 API 서버**: [http://localhost:3000/docs](http://localhost:3000/docs)
  - System, Auth, PDF, Markdown Documents/Folders/Tags/Revisions/Search/Assets
- **AI Workspace 서버**: [http://localhost:3001/docs](http://localhost:3001/docs)
  - `POST /api/v1/ai/search`: 개인 문서 시맨틱 벡터 검색
  - `POST /api/v1/ai/chat`: 단발성 대화 및 자동 Tool Calling 루프
  - `POST /api/v1/ai/chat/stream`: SSE 실시간 스트리밍 대화

---

## 6. CI/CD 및 배포 파이프라인 (GitHub Actions & GitOps)

`.github/workflows` 하위에 3개의 독립적인 자동화 파이프라인이 구성되어 있습니다:

```text
.github/workflows/
├── ci.yml                     # PR 및 main push 시 린트, Vitest 테스트, 모노레포 전체 빌드 자동 검증
├── docker-publish.yml         # API 앱 Dockerfile.api 빌드 및 GitOps(homelab-infra backend) 태그 갱신
└── docker-publish-ai.yml      # AI 앱 Dockerfile.ai 빌드 및 GitOps(homelab-infra ai) 태그 갱신
```

### Docker 빌드 방식 (`Dockerfile.api`, `Dockerfile.ai`)

애플리케이션별 특화된 경량 도커 이미지를 위해 Dockerfile이 물리적으로 분리되어 있습니다:

```bash
# API 서버 컨테이너 빌드 (PDF 조작용 qpdf 포함)
$ docker build -f Dockerfile.api -t my-space-api:latest .

# AI Workspace 서버 컨테이너 빌드 (경량 dumb-init 전용 런타임)
$ docker build -f Dockerfile.ai -t my-space-ai:latest .
```

---

## 7. 스펙 주도 개발 (SDD) 문서

본 프로젝트의 모든 비즈니스 규칙과 아키텍처 결정은 `docs/` 하위의 사양서 및 ADR을 단일 진실 공급원(Single Source of Truth)으로 삼아 관리됩니다:

- [ADR 인덱스 (`docs/adr/`)](file:///Users/limkeunhyeok/workspace/my-space-backend/docs/adr/README.md)
  - [ADR-0001: Nest CLI 모노레포 전환 및 AI Workspace 서비스 프로세스 분리](file:///Users/limkeunhyeok/workspace/my-space-backend/docs/adr/0001-nest-cli-monorepo-ai-service-separation.md)
- [기능 사양서 인덱스 (`docs/specs/`)](file:///Users/limkeunhyeok/workspace/my-space-backend/docs/specs/README.md)
  - [ai-workspace.md: AI Workspace 도메인 사양서](file:///Users/limkeunhyeok/workspace/my-space-backend/docs/specs/ai-workspace.md)
  - [markdown-documents.md: 마크다운 문서 도메인 사양서](file:///Users/limkeunhyeok/workspace/my-space-backend/docs/specs/markdown-documents.md)
  - [pdf-tools.md: PDF 조작 도메인 사양서](file:///Users/limkeunhyeok/workspace/my-space-backend/docs/specs/pdf-tools.md)
