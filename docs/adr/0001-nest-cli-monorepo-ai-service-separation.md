---
# MADR 4.0.0 양식 — https://adr.github.io/madr/
status: accepted
date: 2026-10-06
decision-makers: [Keunhyeok Lim]
---

# Nest CLI 표준 모노레포 구조 채택 및 AI 로직 서버(apps/ai) 독립 분리

## 맥락과 문제 정의 (Context and Problem Statement)

현재 `my-space-backend`는 단일 NestJS 애플리케이션(`src/`) 구조로 메인 API(PDF 조작, 마크다운 문서 관리, Authelia 인증, 시스템 헬스체크 등)를 제공하고 있습니다.

여기에 개인 맞춤형 AI Assistant를 담당하는 **AI Workspace** 기능(Google Gemini / Ollama LLM 대화, SSE 스트리밍, Qdrant 기반 벡터 검색, RabbitMQ 비동기 인덱싱 워커, Function Calling)을 추가해야 합니다.

AI 기능은 긴 응답 지연(Long-running / Streaming), 외부 AI Provider API 의존성, 큐 기반 백그라운드 워커 작업 등 일반적인 CRUD API와는 매우 상이한 리소스 사용 패턴과 가용성 특성을 지닙니다. AI 기능의 부하나 장애가 기존 유틸리티 API에 전파되지 않도록 하면서도, 공통 스토리지(Prisma, MinIO) 및 인증 체계를 어떻게 효율적으로 유지할 것인가?

## 의사결정 동기 (Decision Drivers)

* **장애 격리 (Fault Isolation)**: LLM 타임아웃, 대용량 문서 청킹/임베딩 워커 부하가 기존 핵심 API(PDF, 마크다운 등)의 응답성에 영향을 주지 않아야 함.
* **독립 확장성 (Independent Scalability)**: 쿠버네티스(k8s) 환경에서 메인 API와 AI 서버의 Pod 리소스(CPU/메모리) 및 복제본 수(Replica)를 독립적으로 제어할 수 있어야 함.
* **코드 재사용 및 단일 진실 공급원 (Code Reuse & Single Source of Truth)**: Prisma DB 스키마, MinIO 스토리지 클라이언트, Authelia 인증 가드, 공통 예외 처리 체계를 중복 구현 없이 공유해야 함.
* **프로젝트 표준 준수**: `AGENTS.md` 4장에 정의된 "Nest CLI 표준 모노레포(`apps/`, `libs/`) 점진적 확장 전략" 준수.

## 검토한 대안들 (Considered Options)

* **대안 1 (선택)**: **Nest CLI 표준 모노레포(`apps/api`, `apps/ai`, `libs/`) 구조 전환**
* **대안 2**: 단일 애플리케이션 내 모듈 분리 (`src/ai/` 단일 프로세스 유지)
* **대안 3**: 별도 Git 저장소로 완전 분리 (Multi-repo)

## 결정 내용 및 결과 (Decision Outcome)

선택한 안: **대안 1 — "Nest CLI 표준 모노레포(`apps/api`, `apps/ai`, `libs/`) 구조 전환"**

이유:
메인 API와 AI 서버를 독립된 실행 진입점(`main.ts`)과 포트(3000, 3001)를 가진 서브 애플리케이션으로 분리하여 프로세스 및 배포 단위 장애를 완전히 격리하면서도, `libs/`를 통해 DB 모델, MinIO/RabbitMQ/Qdrant 클라이언트, 인증 가드를 안전하게 단일 레포 내에서 공유할 수 있기 때문입니다.

---

### 모노레포 디렉토리 및 책임 분리 구조

```text
my-space-backend/
├── nest-cli.json                      # monorepo: true 설정, 빌드 타겟(api, ai) 등록
├── package.json                       # 공통 패키지 의존성 관리
├── tsconfig.json                      # Path Aliases (@app/common, @app/storage 등)
├── prisma/
│   └── schema.prisma                  # PostgreSQL 단일 공통 스키마
├── docs/                              # SDD 스펙 및 ADR
│   ├── specs/
│   └── adr/
├── apps/
│   ├── api/                           # [메인 API 서버] 기본 포트: 3000
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── markdown/              # 마크다운 CRUD (RabbitMQ로 인덱싱 이벤트 발행)
│   │   │   ├── pdf/                   # PDF 유틸리티
│   │   │   ├── auth/                  # Authelia ForwardAuth
│   │   │   ├── health/                # k8s 프로브
│   │   │   └── version/               # 시스템 버전
│   │   └── tsconfig.app.json
│   │
│   └── ai/                            # [AI Workspace 서버] 기본 포트: 3001
│       ├── src/
│       │   ├── main.ts                # AI 서버 독립 진입점
│       │   ├── ai-app.module.ts       # AI 앱 루트 모듈
│       │   ├── chat/                  # AI Chat (단발성 JSON & SSE 스트리밍)
│       │   ├── search/                # Qdrant 시맨틱 검색 컨트롤러/서비스
│       │   ├── indexing/              # RabbitMQ Consumer 워커 (비동기 인덱싱)
│       │   ├── providers/             # Gemini 3.8 Flash & Ollama qwen3.5:0.8b
│       │   └── tools/                 # search_my_documents, read_document, save_to_markdown
│       └── tsconfig.app.json
│
└── libs/                              # [공유 라이브러리]
    ├── common/                        # 인증 가드, @CurrentUser, 도메인 예외, 로거, Zod 파이프
    └── storage/                       # Prisma, MinIO, Qdrant, RabbitMQ 스토리지 클라이언트
```

---

### 기대 효과 및 영향 (Consequences)

#### 장점
1. **프로세스 및 리소스 완전 격리**:
   * AI 스트리밍이나 인덱싱 배치 작업 중 OOM(Out of Memory)이나 높은 CPU 스파이크가 발생하더라도 메인 API(PDF, 마크다운) 서비스는 무중단 운영됩니다.
2. **독립 배포 및 HPA 적용 용이**:
   * k8s 환경에서 `my-space-api`와 `my-space-ai`를 독립 Deployment 및 Ingress 규칙(`/api/v1/ai` ➔ `my-space-ai`)으로 관리할 수 있습니다.
3. **코드 중복 0%**:
   * `libs/storage`와 `libs/common`을 통해 DB 접근 및 인증 로직을 중복 작성 없이 깔끔하게 재사용합니다.
4. **빌드 도구 일관성**:
   * `nest build api`, `nest build ai`로 단일 CLI 명령을 통해 빌드가 제어되며, NestJS의 ESM 아키텍처 및 TypeScript 표준을 그대로 유지합니다.

#### 트레이드오프 (감수할 점)
1. **초기 마이그레이션 공수**:
   * 기존 루트 `src/` 코드를 `apps/api/src` 및 `libs/`로 재배치하고, TypeScript Path Mapping을 설정해야 합니다.
2. **단위 테스트 및 빌드 파이프라인 관리**:
   * 테스트 실행 시 특정 프로젝트 타겟 지정(`pnpm vitest run apps/api`, `pnpm vitest run apps/ai`) 또는 전체 모노레포 검증 스크립트 구성이 필요합니다.

### 구현 검증 계획 (Confirmation)

1. `nest-cli.json`에 `monorepo: true`, `projects: { api, ai }` 등록 후 `pnpm run build api` 및 `pnpm run build ai` 빌드 검증
2. 기존 135개 단위 테스트가 모노레포 구조 하에서도 깨짐 없이 100% 통과하는지 회귀 검증 (`pnpm run test`)
3. `apps/api`와 `apps/ai`가 각각 3000, 3001 포트에서 독립 기동되는지 검증

---

## 대안별 장단점 세부 비교 (Pros and Cons of the Options)

### 대안 1: Nest CLI 표준 모노레포 (선택)
* **장점**: 프레임워크 표준 준수, 공유 코드 관리 용이, 프로세스/배포 완전 분리, 의존성 단일 관리
* **단점**: 루트 파일 구조 변경에 따른 마이그레이션 초기 공수 필요

### 대안 2: 단일 애플리케이션 내 모듈 분리 (`src/ai` 모듈)
* **장점**: 파일 이동 없이 가장 빠르게 기능 추가 가능
* **단점**: 프로세스 단일화로 인해 AI 부하/에러가 전체 시스템 장애로 직결됨. 독립 스케일 아웃 불가.

### 대안 3: 별도 Git 레포지토리 (Multi-repo)
* **장점**: 레포지토리 간 완전한 물리적 분리
* **단점**: Prisma 스키마, MinIO/Auth 공통 코드를 공유하기 위해 별도 npm 패키지 레지스트리 구축 또는 서브모듈 관리가 필요하여 유지보수 비용 극대화.

---

## 참고 및 관련 정보 (More Information)

* [NestJS Monorepo Documentation](https://docs.nestjs.com/cli/monorepo)
* [AGENTS.md Section 4: 아키텍처 및 모노레포 전환 전략](file:///Users/limkeunhyeok/workspace/my-space-backend/.agents/AGENTS.md)
* [MADR 4.0.0 Specification](https://adr.github.io/madr/)
