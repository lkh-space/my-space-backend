---
# MADR 4.0.0 양식 — https://adr.github.io/madr/
status: accepted
date: 2026-10-11
decision-makers: [Keunhyeok Lim]
---

# pnpm Workspaces 기반 앱별 독립 패키지 및 0.1.0 버전 관리 체계 도입

## 맥락과 문제 정의 (Context and Problem Statement)

[ADR-0001](./0001-nest-cli-monorepo-ai-service-separation.md)을 통해 Nest CLI 표준 모노레포(`apps/api`, `apps/ai`, `libs/`) 구조로 서비스를 분리하였으나, 패키지 의존성 및 버전 정보는 프로젝트 루트의 단일 `package.json`(`version: 0.0.1`)에서 일괄 관리되고 있었습니다.

향후 메인 API(`apps/api`)와 AI Workspace(`apps/ai`)는 기능 개발 주기, 변경 빈도, 배포 파이프라인 및 컨테이너 이미지 태깅이 서로 다른 생명주기(Lifecycle)로 운영될 예정입니다. 단일 `package.json` 버전 체제에서는 어느 한쪽 앱만 기능 개선되어 버전이 변경되더라도 다른 앱의 버전까지 종속되거나, 모니터링/로깅/Swagger 문서에서 각 앱의 정확한 릴리즈 버전을 식별하기 어렵습니다.

따라서 Nest CLI 모노레포 구조를 유지하면서도 `api`와 `ai`의 버전을 독립적으로 관리하고 릴리즈할 수 있는 표준 패키지 관리 체계를 확립해야 합니다.

## 의사결정 동기 (Decision Drivers)

* **독립적인 릴리즈 및 세맨틱 버저닝 (Independent SemVer)**: `api`와 `ai`의 릴리즈 주기 및 SemVer 버전을 독자적으로 전진시킬 수 있어야 함.
* **표준 패키지 관리자 생태계 호환**: pnpm 표준 도구 및 Changesets 등 모노레포 릴리즈 자동화 도구와 자연스럽게 연동 가능해야 함.
* **런타임 및 관측성 일치**: 각 앱의 런타임 엔드포인트(`GET /version`), Swagger 문서, Pino 부팅 로그에서 해당 앱의 고유 버전과 패키지명이 정확히 노출되어야 함.
* **컨테이너 빌드 정합성**: 멀티스테이지 Dockerfile 빌드 환경에서도 의존성 캐싱 및 빌드가 무결하게 유지되어야 함.

## 검토한 대안들 (Considered Options)

* **대안 1 (선택)**: **pnpm Workspaces 도입 및 앱별 `package.json` 분리 (`@my-space/*` 스코프)**
* **대안 2**: 루트 `package.json`의 `config` 필드에 앱별 버전 메타데이터 기록
* **대안 3**: 각 앱 소스 코드 내부 상수 파일(`version.ts`) 수동 관리

## 결정 내용 및 결과 (Decision Outcome)

선택한 안: **대안 1 — "pnpm Workspaces 도입 및 앱별 `package.json` 분리 (`@my-space/*` 스코프)"**

이유:
이미 패키지 매니저로 `pnpm`을 사용 중이므로 `pnpm-workspace.yaml`을 활성화하여 `apps/*`와 `libs/*`를 워크스페이스 패키지로 등록하는 것이 가장 정석적이며 확장성 높은 모노레포 표준이기 때문입니다.

* **패키지 네이밍**: `@my-space/api`, `@my-space/ai`, `@my-space/common`, `@my-space/storage`, `@my-space/config`
* **초기 버전**: `api`와 `ai` 모두 `0.1.0`으로 정렬하여 신규 세맨틱 버저닝 시작
* **버전 모듈 공통화**: 기존 `apps/api`에만 존재하던 `VersionModule`을 `@app/common` 라이브러리로 승격하여, `api`와 `ai` 두 앱 모두에서 동일한 규격의 `GET /version` 엔드포인트를 노출

---

### 디렉토리 및 패키지 구조

```text
my-space-backend/
├── pnpm-workspace.yaml          # packages: ['apps/*', 'libs/*']
├── package.json                 # 루트 오케스트레이션 및 공통 도구
├── pnpm-lock.yaml               # 워크스페이스 전체 의존성 락파일
├── apps/
│   ├── api/
│   │   ├── package.json         # @my-space/api (version: 0.1.0)
│   │   └── src/
│   └── ai/
│       ├── package.json         # @my-space/ai (version: 0.1.0)
│       └── src/
└── libs/
    ├── common/
    │   ├── package.json         # @my-space/common (private: true)
    │   └── src/version/         # 공통 VersionModule, Service, Controller
    ├── storage/
    │   └── package.json         # @my-space/storage (private: true)
    └── config/
        └── package.json         # @my-space/config (private: true)
```

---

### 기대 효과 및 영향 (Consequences)

#### 장점
1. **독립 버전 관리 체계 확립**:
   - `apps/api`와 `apps/ai`의 버전을 개별적으로 범프(`0.1.0` ➔ `0.1.1` vs `0.2.0`)할 수 있습니다.
2. **코드 중복 없는 엔드포인트 제공**:
   - `VersionModule`이 `@app/common`으로 승격되어 `api`와 `ai` 모두 `GET /version` 및 `GET /api/v1/version` 엔드포인트를 표준화된 형태로 제공합니다.
3. **향후 의존성 격리 용이**:
   - 필요 시 `@google/genai`, `@qdrant/js-client-rest` 등 AI 전용 의존성을 `apps/ai/package.json`으로 이동시켜 경량화된 컨테이너 이미지를 빌드할 수 있는 토대가 마련됩니다.

#### 트레이드오프 및 관리점
1. **Docker 빌드 컨텍스트**:
   - `Dockerfile.api` 및 `Dockerfile.ai`에서 의존성 설치 시 하위 워크스페이스의 `package.json`들을 함께 복사해야 합니다.

---

## 참고 및 관련 정보 (More Information)

* [pnpm Workspaces 공식 문서](https://pnpm.io/workspaces)
* [ADR-0001: Nest CLI 표준 모노레포 구조 채택 및 AI 로직 서버(apps/ai) 독립 분리](./0001-nest-cli-monorepo-ai-service-separation.md)
* [docs/specs/version-info.md](../specs/version-info.md)
