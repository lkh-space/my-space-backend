# My Space Backend (`my-space-backend`) — 프로젝트 개요 및 아키텍처 가이드

> **문서 목적**:  
> 본 문서는 **My Space Backend** 프로젝트의 설계 비전, 전체 시스템 아키텍처, 기술 스택, 모노레포 디렉토리 구조, 핵심 비즈니스 도메인, 보안 및 신뢰성 엔지니어링 표준을 종합적으로 정리한 단일 진실 소스(SSOT) 개요서입니다.  
> 다른 AI 에이전트, 외부 아키텍트, 개발자가 본 시스템의 맥락과 기술 표준을 즉시 파악하고 일관된 규칙 하에 개발 및 확장을 수행할 수 있도록 지원합니다.

---

## 1. 프로젝트 비전 및 목적 (Project Vision & Purpose)

- **개인 맞춤형 유틸리티 백엔드 플랫폼**:
  - 개발자 개인이 일상 및 업무에서 자주 사용하는 유틸리티(PDF 가공, 마크다운 지식 베이스, 개인화 AI 비서 및 RAG 시맨틱 검색 등)를 외부 상용 서비스에 의존하지 않고, 자체 인프라(홈랩/클라우드)에서 높은 자유도와 보안성으로 직접 호스팅하는 백엔드 공간입니다.
- **점진적 확장성 및 모노레포 아키텍처 (Monorepo Architecture)**:
  - Nest CLI 표준 모노레포(`apps/`, `libs/`) 및 `pnpm Workspaces`를 채택하여, 메인 REST API 게이트웨이(`apps/api`)와 고부하 연산 중심의 AI 워크스페이스(`apps/ai`)를 물리적 프로세스로 분리 운영합니다.
  - 공통 비즈니스 도메인 로직은 독립 공유 라이브러리(`libs/markdown-core`, `libs/storage`, `libs/common`, `libs/config`)로 캡슐화하여 서비스 간 코드 중복과 데이터 소유권 침해를 원천 차단합니다.

---

## 2. 전체 시스템 아키텍처 및 데이터 흐름

### 2.1 하이레벨 아키텍처 다이어그램 (High-Level Architecture)

```mermaid
graph TB
    subgraph Client ["클라이언트 계층"]
        WebFront["Web Front (Next.js / Vite)"]
        ExternalAPI["외부 클라이언트 / 모바일"]
    end

    subgraph Ingress ["인프라 / 보안 게이트웨이"]
        ReverseProxy["Reverse Proxy (Nginx / Traefik)"]
        Authelia["Authelia SSO (Forward Auth)"]
    end

    subgraph Apps ["애플리케이션 계층 (NestJS Apps)"]
        ApiApp["apps/api (메인 REST API)<br>Port: 3000"]
        AiApp["apps/ai (AI Workspace / RAG)<br>Port: 3001"]
    end

    subgraph Libs ["공유 라이브러리 (Shared Libs)"]
        CommonLib["libs/common<br>(CoreHttpModule, Fail-Closed Guard, RFC 7807, Masker)"]
        ConfigLib["libs/config<br>(Zod 기반 타입 세이프 환경변수 검증)"]
        StorageLib["libs/storage<br>(Prisma, MinIO, OpenSearch, Qdrant, RabbitMQ)"]
        MarkdownCoreLib["libs/markdown-core<br>(단일화된 마크다운 생성/수정/태그 도메인 서비스)"]
    end

    subgraph Storage ["데이터 및 메시지 저장소 계층"]
        PG[(PostgreSQL<br>메타데이터, 계층 폴더, 태그, 리비전)]
        MinIO[(MinIO S3<br>마크다운 원본, 에셋, 임시 PDF)]
        OpenSearch[(OpenSearch<br>전문 풀텍스트 BM25 검색)]
        Qdrant[(Qdrant Vector DB<br>768차원 시맨틱 벡터 인덱스)]
        RabbitMQ([RabbitMQ<br>markdown-indexing-queue + DLX/DLQ/Retry])
    end

    subgraph AIProviders ["AI 파운데이션 모델"]
        Gemini["Google Gemini (운영 환경)<br>gemini-3.8-flash"]
        Ollama["Ollama (로컬/오프라인 환경)<br>qwen3.5:0.8b"]
    end

    %% 연결 관계
    WebFront --> ReverseProxy
    ExternalAPI --> ReverseProxy
    ReverseProxy -.인증 검증.-> Authelia
    ReverseProxy -->|신뢰 헤더 주입 (Remote-*)| ApiApp
    ReverseProxy -->|신뢰 헤더 주입 (Remote-*)| AiApp

    ApiApp --> CommonLib
    ApiApp --> ConfigLib
    ApiApp --> StorageLib
    ApiApp --> MarkdownCoreLib

    AiApp --> CommonLib
    AiApp --> ConfigLib
    AiApp --> StorageLib
    AiApp --> MarkdownCoreLib

    StorageLib --> PG
    StorageLib --> MinIO
    StorageLib --> OpenSearch
    StorageLib --> Qdrant
    StorageLib --> RabbitMQ

    ApiApp -->|비동기 인덱싱 발행 + reqId 헤더| RabbitMQ
    RabbitMQ -->|멱등 소비 + 분산 추적| AiApp
    AiApp --> Gemini
    AiApp --> Ollama
```

### 2.2 비동기 이벤트 기반 인덱싱 및 복원력 파이프라인
1. **문서 발행 트랜잭션 (`apps/api`)**:
   - 사용자가 문서를 생성/수정/가져오기(`import`)하면 PostgreSQL 트랜잭션과 MinIO 저장이 수행됩니다.
   - 저장이 성공하면 `RabbitMQ`의 `markdown-indexing-queue`에 `INDEX` 이벤트가 비동기 발행되며, 분산 추적을 위해 HTTP 요청의 `requestId`가 메시지 헤더에 바인딩됩니다.
2. **워커 복원력 및 멱등 색인 (`apps/ai`)**:
   - `IndexingConsumerWorker`가 이벤트를 수신하여 최신 마크다운 본문을 MinIO에서 로드합니다.
   - **결정적 포인트 ID**: 문서 ID와 청크 인덱스를 조합한 UUID v5 해시를 Qdrant 포인트 ID로 사용하여, 네트워크 지연으로 동일 메시지가 재전달(redelivery)되어도 포인트가 중복 누적되지 않고 멱등하게 덮어써집니다.
   - **Zero-downtime Upsert**: 신규 청크들을 먼저 Qdrant에 Upsert한 후 구버전 벡터를 삭제하여 검색 공백을 방지합니다.
   - **장애 격리 (DLX/DLQ/Retry)**: MinIO 일시 다운이나 Qdrant 장애 시 예외를 던져 5초 TTL 지연 재시도 큐(`*.retry`)로 라우팅하며, 3회 초과 실패 시 Dead Letter Queue(`*.dlq`)로 격리하여 메시지 유실을 방지합니다.

---

## 3. 기술 스택 및 도구 표준 (Technology Stack)

| 구분 | 도입 기술 / 라이브러리 | 버전 / 상세 내용 |
| :--- | :--- | :--- |
| **프레임워크** | NestJS | v12.0.x (ESM 네이티브 아키텍처) |
| **런타임** | Node.js | v24.x (Native ESM - `"type": "module"`) |
| **언어** | TypeScript | v6.0.x (`module: nodenext`, Nest CLI 컴파일러 API 호환) |
| **패키지 매니저** | pnpm (Workspaces) | v12.4.x (Corepack 연동, 6개 모노레포 패키지 관리) |
| **빌더 / 컴파일러** | Rspack (`@rspack/core`) | Nest CLI 컴파일러 옵션 연동으로 초고속 번들링 제공 |
| **ORM & DB** | Prisma, PostgreSQL | PostgreSQL 16+, Prisma ORM 6.x (정식 `prisma migrate` 체계) |
| **오브젝트 스토리지** | AWS SDK v3 (S3 호환) | MinIO (마크다운 원본, 첨부 이미지/에셋, 임시 PDF) |
| **검색 엔진** | OpenSearch, Qdrant | 전문 풀텍스트 검색(OpenSearch) + 768차원 시맨틱 벡터 DB(Qdrant) |
| **메시지 브로커** | RabbitMQ (`amqplib`) | 마크다운 문서 인덱싱 비동기 이벤트 큐 (DLX/DLQ, 자동 재연결) |
| **AI LLM 공급자** | Google GenAI SDK, Ollama | Google Gemini (`gemini-3.8-flash`), Ollama (로컬 오픈소스 모델) |
| **PDF 처리 엔진** | `qpdf` CLI, `pdf-lib` | 고성능 보안 CLI 직접 연동 (`--password-file=-`, 타임아웃 방어) |
| **인증 (Auth)** | Authelia Forward Auth | 리버스 프록시 헤더 기반 SSO, 프로덕션 Fail-Closed 방어 |
| **로깅 & 관측성** | Pino (`nestjs-pino`), Observe | Loki 호환 단일라인 JSON 로깅, AsyncLocalStorage 기반 분산 추적 |
| **테스트 & 품질** | Vitest, Testcontainers, oxlint | BDD 스타일 초고속 테스트 러너, PostgreSQL 컨테이너 E2E, Rust 기반 초고속 린터 |

---

## 4. 디렉토리 구조 및 모듈 맵 (Project Layout)

```text
my-space-backend/
├── apps/
│   ├── api/                           # 메인 REST API 서버 (포트 3000)
│   │   ├── src/
│   │   │   ├── auth/                  # Authelia 인증 사용자 프로필 조회 컨트롤러
│   │   │   ├── markdown/              # 마크다운 도메인 (문서, 폴더, 태그, 리비전, 에셋, 검색)
│   │   │   │   ├── controllers/       # Document, Folder, Tag, Revision, Asset, Search 컨트롤러
│   │   │   │   ├── services/          # 도메인 비즈니스 연산 및 트랜잭션 로직
│   │   │   │   ├── dto/               # Zod 기반 유효성 검증 DTO
│   │   │   │   └── exceptions/        # BaseDomainException 상속 마크다운 전용 도메인 예외
│   │   │   ├── pdf/                   # PDF 유틸리티 도메인 (qpdf 직접 실행 및 pdf-lib 가공)
│   │   │   │   ├── controllers/       # PDF 검사, 암호해제, 병합, 분할 엔드포인트
│   │   │   │   ├── engines/           # QpdfEngine (CLI spawn), PdflibEngine, ZipEngine
│   │   │   │   ├── services/          # PDF 바이너리 가공 서비스
│   │   │   │   └── exceptions/        # 불변 도메인 예외 (PdfMinFilesException 등)
│   │   │   ├── app.module.ts          # API 메인 모듈 (CoreHttpModule 공통 임포트)
│   │   │   └── main.ts                # API 부트스트랩 엔트리포인트 (종료 훅, CORS)
│   │   ├── package.json               # @my-space/api
│   │   └── tsconfig.app.json
│   │
│   └── ai/                            # AI Workspace 서비스 (포트 3001)
│       ├── src/
│       │   ├── chat/                  # AI 채팅 (단발성 질의 및 SSE 실시간 스트리밍)
│       │   ├── indexing/              # RabbitMQ 기반 비동기 인덱싱 워커 컨슈머 (멱등성 보장)
│       │   ├── providers/             # LLM 추상화 (GeminiProvider, OllamaProvider, ProviderFactory)
│       │   ├── search/                # Qdrant 기반 768차원 시맨틱 벡터 검색 API
│       │   ├── sessions/              # 신경망/AI 세션 관리 컨트롤러
│       │   ├── tools/                 # AI Tool Calling (libs/markdown-core 연동 문서 저장)
│       │   ├── utils/                 # 헤딩/코드블록 보존 마크다운 청커, UUID v5 생성기
│       │   ├── voice/                 # 양방향 음성 스트리밍 비서 (STT/TTS/인터럽트 IDOR 방어)
│       │   ├── ai-app.module.ts       # AI 메인 모듈 (CoreHttpModule 공통 임포트)
│       │   └── main.ts                # AI 부트스트랩 엔트리포인트
│       ├── package.json               # @my-space/ai
│       └── tsconfig.app.json
│
├── libs/                              # 비즈니스 공통 및 인프라 공유 라이브러리
│   ├── common/                        # 전사 공유 인프라/프레임워크 라이브러리
│   │   ├── src/
│   │   │   ├── core/                  # CoreHttpModule (Filter, Pipe, Interceptor 일원화)
│   │   │   ├── decorators/            # @CurrentUser(), @Public() 커스텀 데코레이터
│   │   │   ├── exceptions/            # BaseDomainException, StorageObjectNotFoundException 등
│   │   │   ├── filters/               # AllExceptionsFilter, DOMAIN_ERROR_HTTP_MAP (RFC 7807)
│   │   │   ├── guards/                # RemoteUserGuard (Fail-Closed, 프록시 시크릿, 정규식)
│   │   │   ├── health/                # K8s Liveness/Readiness 헬스체크 모듈 (Terminus 연동)
│   │   │   ├── interceptors/          # AuditLogInterceptor (순환 참조 방지, 4단계 민감정보 마스킹)
│   │   │   ├── logger/                # Pino 로거 설정 및 TraceContext 연동 로깅
│   │   │   ├── markdown/              # safeMatter (gray-matter RCE 엔진 원천 차단 파서)
│   │   │   ├── pipes/                 # ZodValidationPipe (초경량 런타임 스키마 검증)
│   │   │   ├── tracing/               # TraceContextService (AsyncLocalStorage 분산 추적)
│   │   │   └── version/               # Git 브랜치/커밋 해시 기반 /version 모듈
│   │   └── package.json               # @my-space/common
│   │
│   ├── config/                        # 중앙 집중형 환경 설정 라이브러리
│   │   ├── src/                       # Zod 기반 env 검증 및 app, ai, db, minio, qdrant 등 네임스페이스
│   │   └── package.json               # @my-space/config
│   │
│   ├── markdown-core/                 # 단일화된 마크다운 데이터 서비스 라이브러리
│   │   ├── src/
│   │   │   ├── services/              # MarkdownWriterService, TagResolverService (원자적 DB 트랜잭션)
│   │   │   └── markdown-core.module.ts
│   │   └── package.json               # @my-space/markdown-core
│   │
│   └── storage/                       # 물리적 데이터/인프라 클라이언트 연동 라이브러리
│       ├── src/
│       │   ├── prisma/                # PrismaService (PostgreSQL 연결 수명주기)
│       │   ├── minio/                 # MinioService (S3 버킷 생성, 스트리밍, 배치 삭제)
│       │   ├── opensearch/            # OpenSearchService (텍스트 인덱싱, HTML 하이라이트 이스케이프)
│       │   ├── qdrant/                # QdrantService (컬렉션 생성, 페이로드 격리, 벡터 검색)
│       │   ├── rabbitmq/              # RabbitmqService (토폴로지 선언, 지수 백오프 자동 재연결)
│       │   └── storage.module.ts      # 스토리지 모듈 통합 번들
│       └── package.json               # @my-space/storage
│
├── prisma/
│   ├── migrations/                    # 정식 마이그레이션 SQL (부분 유니크 인덱스, 복합 인덱스)
│   └── schema.prisma                  # PostgreSQL 데이터 모델 (Folder, Document, Tag, DocumentRevision)
├── test/                              # 종합 E2E 및 테스트 유틸리티
│   ├── api/                           # 메인 API E2E (auth, pdf, markdown, security)
│   │   ├── markdown/                  # tenant-isolation(IDOR 방어), concurrent-update(OCC 경합)
│   │   └── security/                  # frontmatter-rce(C-1 RCE 원천 차단 E2E)
│   ├── ai/                            # AI 서비스 E2E (chat, search, indexing, health)
│   └── lib/                           # Testcontainers, Fake 스토리지 (컴파일 정합성 인터페이스 강제)
├── docs/                              # 스펙 주도 개발(SDD) 문서 저장소
│   ├── specs/                         # 도메인별 기능 사양서 (Single Source of Truth)
│   └── adr/                           # 아키텍처 의사결정 기록 (MADR 4.0.0 규격)
├── pnpm-workspace.yaml                # pnpm 모노레포 워크스페이스 선언 (apps 2개, libs 4개)
├── nest-cli.json                      # Nest CLI 모노레포 및 Rspack 빌더 설정
├── tsconfig.json                      # 최상위 TypeScript 설정 (NodeNext, path aliases)
└── Dockerfile.api / Dockerfile.ai     # dumb-init 포함 경량화 멀티스테이지 컨테이너 이미지
```

---

## 5. 핵심 비즈니스 도메인 및 상세 기능

### 5.1 PDF 조작 도메인 (`apps/api/src/pdf`)
- **보안 CLI 기반 암호 해제 (Unlock)**:
  - 기존 손상 버그가 있던 `node-qpdf2`를 배제하고, `qpdf` 바이너리를 직접 `spawn`하여 복호화 수행.
  - 비밀번호를 `argv`에 노출하지 않고 표준 입력(`--password-file=-`)으로 안전하게 주입하며, 30초 프로세스 타임아웃으로 좀비 프로세스를 방지.
- **PDF 병합 (Merge) & 분할 (Split)**:
  - 여러 개의 PDF 파일을 순서대로 결합하거나 페이지 범위 파서(`parsePageRanges`)를 통해 필요한 페이지만 안전하게 추출.
- **업로드 보호 및 DoS 방어**:
  - 단일/병합 엔드포인트에 Multer `limits`(`fileSize: 50MB`, `files: 20`) 적용 및 파일 개수 불변 예외(`PdfMinFilesException`, `PdfMaxFilesException`) 도입.

### 5.2 마크다운 지식 베이스 도메인 (`apps/api/src/markdown`, `libs/markdown-core`)
- **안전한 프론트매터 파싱 (`safeMatter`)**:
  - `gray-matter`의 자바스크립트 실행 엔진(`---js`, `---coffee`)을 원천 거절(`MARKDOWN_UNSAFE_FRONTMATTER` 400 Bad Request)하여 임의 코드 실행(RCE) 차단.
- **하이브리드 저장 & 리비전 이력 관리**:
  - 메타데이터는 **PostgreSQL**, 본문 및 에셋은 **MinIO S3**에 분리 저장.
  - 내용 변경 시 과거 리비전 스냅샷을 자동 보존하며, 문서 삭제 시 모든 과거 리비전을 MinIO S3에서 일괄 배치 삭제(`deleteObjects`)하여 고아 객체 누적 방지.
- **낙관적 동시성 잠금 (OCC, Optimistic Concurrency Control)**:
  - `If-Match: "1"` 헤더 지원: 클라이언트가 보낸 버전과 DB `currentVersion` 대조 및 트랜잭션 내 `updateMany` 검증으로 Lost Update 방지 (충돌 시 409 Conflict 반환).
- **에셋 보안 및 XSS 방어**:
  - SVG 업로드 시 인라인 이벤트(`onload`), `<script>`, `javascript:`, XXE 패턴을 정밀 검사하여 차단.
  - SVG 파일 서빙 시 `Content-Disposition: attachment`로 강제 다운로드 처리 및 `Content-Security-Policy: sandbox` 적용.

### 5.3 AI Workspace 도메인 (`apps/ai`)
- **다중 LLM 추상화 (`ProviderFactory`)**:
  - 운영 환경: Google Gemini (`gemini-3.8-flash`, `text-embedding-004`).
  - 로컬/오프라인 환경: Ollama (`qwen3.5:0.8b` 등 로컬 모델).
  - 외부 API 타임아웃, 재시도, 서킷 브레이커 적용으로 장애 격리.
- **시맨틱 벡터 검색 및 RAG**:
  - 사용자 질문의 임베딩을 추출하여 Qdrant에서 상위 유사도 문서 청크(Cosine Similarity) 고속 조회.
- **AI Tool Calling (데이터 소유권 단일화)**:
  - AI가 `save_to_markdown` 도구를 호출할 때 `libs/markdown-core`의 `MarkdownWriterService`를 호출하여 타인 폴더에 무단 저장하는 IDOR를 원천 차단하고 단일 트랜잭션으로 저장.
- **실시간 스트리밍 & 양방향 음성 비서 파이프라인**:
  - SSE 스트리밍 시 클라이언트 연결 종료(`req.on('close')`) 감지 및 AbortSignal 전파로 불필요한 LLM 과금 방지.
  - 음성 비서 인터럽트(`POST /api/v1/ai/voice/interrupt`) 시 세션 소유권 검증으로 타인 세션 음성 차단 방어.

---

## 6. 엔지니어링 표준 및 핵심 설계 원칙

### 6.1 스펙 주도 개발 (SDD, Spec-Driven Development) & ADR
- 모든 비즈니스 기능은 `docs/specs/<feature>.md` 사양서를 단일 진실 공급원(SSOT)으로 삼습니다. 임의 추측으로 로직을 구현하지 않습니다.
- 중대한 기술적/구조적 결정은 `docs/adr/`에 MADR 4.0.0 형식으로 기록하고 불변으로 관리합니다.

### 6.2 전송 계층과 도메인의 완전 분리 (Error Handling Protocol)
- 비즈니스/도메인 계층은 `@nestjs/common`의 HTTP 상태 코드(400, 404, 500 등)를 일절 참조하거나 임포트하지 않습니다.
- 모든 도메인 예외는 `BaseDomainException`(`libs/common/src/exceptions/domain.exception.ts`)을 상속받고 고유한 비즈니스 코드 문자열(`code`)을 가집니다.
- 전송 프로토콜(HTTP)로 변환하는 책임은 전역 필터(`AllExceptionsFilter`)와 매핑 테이블(`DOMAIN_ERROR_HTTP_MAP` in `libs/common/src/filters/domain-error-http.map.ts`)이 전담합니다. 등록되지 않은 예외는 기본 `422 Unprocessable Entity`로 안전하게 폴백됩니다.
- 에러 응답은 RFC 7807 (Problem Details) 표준(`type`, `title`, `status`, `detail`, `instance`, `code`, `traceId`)을 준수합니다.

### 6.3 Authelia Forward Auth 및 Fail-Closed 보안 체계
- 리버스 프록시가 주입하는 신뢰 헤더(`Remote-User`)를 `RemoteUserGuard`에서 파싱하여 `req.user`(`AuthUser`)에 바인딩합니다.
- **Fail-Closed 프로덕션 기본값**: `IS_LOCAL="true"`가 명시적으로 설정되지 않은 모든 환경(기본값, `undefined`, `production`)에서는 Mock 사용자가 주입되지 않고 즉시 `401 Unauthorized`를 발생시켜 인증 우회를 원천 방어합니다.
- **프록시 시크릿 검증**: `AUTH_FORWARDED_SECRET` 환경변수를 통해 인가된 리버스 프록시를 거치지 않은 직접 요청을 차단합니다.
- **정규식 검증**: `Remote-User`에 허용된 문자열(`^[a-zA-Z0-9._@-]+$`)만 통과시켜 헤더 인젝션을 방어합니다.
- **Secure by Default 전역 가드**: 모든 엔드포인트는 기본적으로 인증을 요구하며, 인증이 불필요한 공개 API(헬스체크 등)는 `@Public()` 데코레이터를 명시해야 합니다.

### 6.4 공통 HTTP 횡단 관심사 캡슐화 (`CoreHttpModule`)
- `AllExceptionsFilter`, `AuditLogInterceptor`, `ZodValidationPipe`를 `libs/common`의 `CoreHttpModule`로 단일 번들링하여, `apps/api`, `apps/ai`, 그리고 E2E 테스트 모듈 전체에 동일하게 주입함으로써 환경 간 구성 드리프트를 원천 차단합니다.
- 감사 로깅 인터셉터는 순환 참조(Circular Reference) 방어 및 4단계 심층 순환 마스킹 엔진(`SensitiveDataMasker`)을 탑재하여 민감정보 노출을 방지합니다.

### 6.5 메시지 브로커 신뢰성 및 분산 추적
- RabbitMQ 채널 단절 시 지수 백오프 + 지터 기반으로 자동 재연결(`scheduleReconnect`)하며, 기존 등록된 컨슈머를 자동으로 재바인딩합니다.
- 처리 실패 메시지는 지연 재시도 큐(`*.retry`)를 거쳐 3회 초과 시 DLQ(`*.dlq`)로 안전하게 격리됩니다.
- `TraceContextService`(Node.js `AsyncLocalStorage` 기반)를 통해 들어온 HTTP 요청의 `requestId`를 비동기 큐 메시지 헤더와 워커 로깅(`[reqId=...]`)까지 일관되게 전파합니다.

### 6.6 Node.js Native ESM 규격 준수
- 본 프로젝트는 `"type": "module"` 및 `module: nodenext` 환경입니다.
- 상대 경로 임포트 시 로컬 파일은 **반드시 `.js` 확장자를 명시**해야 합니다. (예: `import { ... } from './foo.service.js'`)
- 라이브러리 간 참조는 `tsconfig.json`의 paths 별칭(`@app/common`, `@app/storage`, `@app/config`, `@app/markdown-core`)을 사용합니다.

---

## 7. 테스트 전략 및 품질 보증 체계

본 프로젝트는 고도의 보안성과 비즈니스 신뢰성을 위해 체계적인 단위 및 E2E 테스트 스위트를 갖추고 있습니다:

```bash
# 1. 초고속 정적 분석 (oxlint)
$ pnpm run lint
Found 0 warnings and 0 errors. (218 files)

# 2. 전체 단위 테스트 (Vitest BDD 스타일)
$ pnpm run test
Test Files  56 passed (56)
Tests       337 passed (337)

# 3. 전체 E2E 통합 테스트 (PostgreSQL Testcontainers)
$ pnpm run test:e2e
Test Files  19 passed (19)
Tests       67 passed (67)
```

- **BDD(Given-When-Then) 원칙**: 모든 단위/통합 테스트는 BDD 구조로 명확히 작성됩니다.
- **크로스 테넌트 IDOR 방어 검증 (`tenant-isolation.e2e-spec.ts`)**: 타 사용자의 문서/폴더/리비전/에셋에 대한 수정, 삭제, 복원, 다운로드 시도가 404/403으로 완벽 차단됨을 실제 DB 환경에서 전수 검증.
- **악성 프론트매터 RCE 방어 검증 (`frontmatter-rce.e2e-spec.ts`)**: `---js` 등 실행 엔진 페이로드 업로드 시 400 Bad Request로 안전하게 거절됨을 검증.
- **동시성 잠금 경합 검증 (`concurrent-update.e2e-spec.ts`)**: 동일 버전에 대한 동시 수정 경합 시 1건 성공(200), 1건 충돌(409 Conflict)로 Lost Update가 방지됨을 검증.
- **Mock 정합성 강제**: 테스트 Fake 스토리지 서비스(`FakeOpenSearchService`, `FakeMinioService` 등)에 `implements Pick<RealService, ...>`를 적용하여 운영 서비스 시그니처 드리프트를 컴파일 타임에 원천 차단.
