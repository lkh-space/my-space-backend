# 03. 데이터 및 인터페이스 (Data & Contracts)

본 문서는 My Space 백엔드 시스템의 정형/비정형 데이터베이스 스키마, 스토리지 및 메시지 큐 통신 규격, 전체 REST/SSE API 엔드포인트 카탈로그, 그리고 전역 에러 응답 규약(RFC 7807)을 실제 구현 코드 기준으로 전수 추출하여 정리한 명세서입니다.

---

## 1. 정형 및 비정형 데이터베이스 설계 명세

### 1.1 PostgreSQL (Prisma 스키마 전수 명세)

#### [테이블 1] `folders` (물리적/계층적 폴더 트리)
- **매핑 모델명**: `Folder`
- **실제 물리 테이블명**: `folders`
- **설계 목적**: 문서의 계층적 디렉토리 구조 및 소유권 격리 지원

| 컬럼명 | DB 컬럼명 | 데이터 타입 | Nullable | 기본값 | 제약조건 및 연관관계 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `TEXT` (UUID) | No | `uuid()` | Primary Key |
| `name` | `name` | `VARCHAR(100)` | No | 없음 | 최대 100자 |
| `parentId` | `parent_id` | `TEXT` (UUID) | Yes | `NULL` | Foreign Key (`folders.id`), `onDelete: Cascade` |
| `ownerId` | `owner_id` | `VARCHAR(100)` | No | 없음 | 소유자 식별자 |
| `createdAt` | `created_at` | `TIMESTAMP(3)` | No | `now()` | 생성 일시 |
| `updatedAt` | `updated_at` | `TIMESTAMP(3)` | No | 갱신 시 자동 갱신 | 수정 일시 |

- **인덱스 및 유니크 제약조건**:
  - `@@unique([name, parentId, ownerId])`: 동일 소유자의 동일 부모 폴더 내 폴더명 중복 생성 방지
  - `@@index([ownerId])`: 소유자별 폴더 목록/트리 고속 조회를 위한 단일 인덱스

---

#### [테이블 2] `documents` (문서 메타데이터 및 스토리지 포인터)
- **매핑 모델명**: `Document`
- **실제 물리 테이블명**: `documents`
- **설계 목적**: 마크다운 문서의 메타데이터, 버전 번호 및 MinIO 오브젝트 키 추적

| 컬럼명 | DB 컬럼명 | 데이터 타입 | Nullable | 기본값 | 제약조건 및 연관관계 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `TEXT` (UUID) | No | `uuid()` | Primary Key |
| `title` | `title` | `VARCHAR(255)` | No | 없음 | 문서 제목 (최대 255자) |
| `folderId` | `folder_id` | `TEXT` (UUID) | Yes | `NULL` | Foreign Key (`folders.id`), `onDelete: SetNull` |
| `ownerId` | `owner_id` | `VARCHAR(100)` | No | 없음 | 소유자 식별자 |
| `currentVersion` | `current_version` | `INTEGER` | No | `1` | 현재 활성 리비전 버전 번호 |
| `objectKey` | `object_key` | `VARCHAR(255)` | No | 없음 | MinIO 문서 버킷 내 원본 오브젝트 경로 |
| `createdAt` | `created_at` | `TIMESTAMP(3)` | No | `now()` | 생성 일시 |
| `updatedAt` | `updated_at` | `TIMESTAMP(3)` | No | 갱신 시 자동 갱신 | 수정 일시 |

- **인덱스 및 유니크 제약조건**:
  - `@@index([ownerId])`: 소유자 기준 전체 문서 목록 조회 최적화
  - `@@index([folderId])`: 특정 폴더 소속 문서 목록 조회 최적화
  - `@@index([ownerId, updatedAt(sort: Desc)])`: 소유자의 최신 수정순 정렬 페이징 복합 인덱스
  - `@@index([ownerId, folderId, updatedAt(sort: Desc)])`: 특정 폴더 내 최신 수정순 정렬 페이징 복합 인덱스

---

#### [테이블 3] `tags` (논리적 다중 분류 태그)
- **매핑 모델명**: `Tag`
- **실제 물리 테이블명**: `tags`
- **설계 목적**: 폴더 계층과 독립적인 사용자별 논리 태그 관리

| 컬럼명 | DB 컬럼명 | 데이터 타입 | Nullable | 기본값 | 제약조건 및 연관관계 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `TEXT` (UUID) | No | `uuid()` | Primary Key |
| `name` | `name` | `VARCHAR(50)` | No | 없음 | 태그 이름 (최대 50자) |
| `ownerId` | `owner_id` | `VARCHAR(100)` | No | 없음 | 소유자 식별자 |
| `createdAt` | `created_at` | `TIMESTAMP(3)` | No | `now()` | 생성 일시 |

- **인덱스 및 유니크 제약조건**:
  - `@@unique([name, ownerId])`: 소유자별 태그 이름 중복 방지
  - `@@index([ownerId])`: 소유자별 태그 목록 조회 인덱스

---

#### [테이블 4] `document_tags` (문서-태그 N:M 조인 테이블)
- **매핑 모델명**: `DocumentTag`
- **실제 물리 테이블명**: `document_tags`
- **설계 목적**: 문서와 태그 간의 다대다(N:M) 매핑 관계 보존

| 컬럼명 | DB 컬럼명 | 데이터 타입 | Nullable | 기본값 | 제약조건 및 연관관계 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `documentId` | `document_id` | `TEXT` (UUID) | No | 없음 | Foreign Key (`documents.id`), `onDelete: Cascade` |
| `tagId` | `tag_id` | `TEXT` (UUID) | No | 없음 | Foreign Key (`tags.id`), `onDelete: Cascade` |

- **인덱스 및 유니크 제약조건**:
  - `@@id([documentId, tagId])`: 복합 기본키 (Composite Primary Key)
  - `@@index([tagId])`: 태그 기준 역방향 문서 검색 최적화 인덱스

---

#### [테이블 5] `document_revisions` (문서 스냅샷 수정 이력)
- **매핑 모델명**: `DocumentRevision`
- **실제 물리 테이블명**: `document_revisions`
- **설계 목적**: 문서 내용 수정 시 과거 버전을 불변 스냅샷으로 보존

| 컬럼명 | DB 컬럼명 | 데이터 타입 | Nullable | 기본값 | 제약조건 및 연관관계 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | `TEXT` (UUID) | No | `uuid()` | Primary Key |
| `documentId` | `document_id` | `TEXT` (UUID) | No | 없음 | Foreign Key (`documents.id`), `onDelete: Cascade` |
| `version` | `version` | `INTEGER` | No | 없음 | 스냅샷 시점의 버전 번호 |
| `title` | `title` | `VARCHAR(255)` | No | 없음 | 해당 리비전 시점의 문서 제목 |
| `objectKey` | `object_key` | `VARCHAR(255)` | No | 없음 | MinIO 리비전 스냅샷 파일 경로 |
| `createdAt` | `created_at` | `TIMESTAMP(3)` | No | `now()` | 리비전 생성 일시 |

- **인덱스 및 유니크 제약조건**:
  - `@@unique([documentId, version])`: 단일 문서 내 버전 번호 중복 생성 방지
  - `@@index([documentId])`: 특정 문서의 과거 이력 역순 조회 인덱스

---

### 1.2 Qdrant 벡터 데이터베이스 스키마 (`libs/storage`, `apps/ai`)

- **컬렉션명**: `personal-documents` (환경변수 `QDRANT_COLLECTION`으로 오버라이드 가능)
- **벡터 차원 수**: `768` (임베딩 모델 `text-embedding-004` / `bge-base-en-v1.5` 표준)
- **거리 측정 메트릭**: `Cosine`
- **청크 Point ID 생성 규칙 (결정론적 UUID v5)**:
  - **알고리즘**: RFC 4122 v5 표준 (SHA-1 해시 기반 결정론적 식별자)
  - **고정 네임스페이스 UUID**: `6f1c4a20-4e3a-4c28-98bb-e30018f3a382` (`DOCUMENT_CHUNK_NAMESPACE`)
  - **결합 Name 규격**: `{documentId}:{chunkIndex}`
  - **목적**: 동일 문서의 동일 청크 인덱스에 대해 언제나 일치하는 UUID를 생성함으로써, 메시지 큐 재시도 및 중복 색인 요청 시 Qdrant 포인트를 안전하게 덮어쓰는(Upsert 멱등성) 보장

| 필드명 (Payload) | 데이터 타입 | 키워드 인덱스(`keyword`) 설정 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| `ownerId` | `string` | **설정됨 (Payload Index)** | 사용자 격리 필터링 키 |
| `documentId` | `string` | **설정됨 (Payload Index)** | 원본 문서 고유 식별자 |
| `version` | `number` | 미설정 | 색인 대상 문서 버전 |
| `chunkIndex` | `number` | 미설정 | 문서 내 청크 순번 (0-based) |
| `title` | `string` | 미설정 | 원본 문서 제목 |
| `heading` | `string` | 미설정 | 청크가 속한 마크다운 헤딩 계층 경로 |
| `content` | `string` | 미설정 | 청크 본문 텍스트 (최대 500~800자 분할) |
| `tags` | `string[]` | **설정됨 (Payload Index)** | 태그 필터링을 위한 문자열 배열 |
| `folderId` | `string \| null` | **설정됨 (Payload Index)** | 소속 폴더 식별자 필터링 키 |
| `embeddingModel` | `string` | **설정됨 (Payload Index)** | 생성에 사용된 임베딩 모델명 |

---

### 1.3 OpenSearch 전문 검색 인덱스 스키마 (`libs/storage`)

- **인덱스명**: `markdown-documents` (환경변수 `OPENSEARCH_INDEX_DOCUMENTS`로 오버라이드 가능)
- **샤드 및 레플리카 설정**:
  - `number_of_shards`: `1` (단일 노드 / 소규모 개인 지식 베이스 최적화)
  - `number_of_replicas`: `0`

| 필드명 | 타입 | 가중치(Boost) | 설명 및 처리 규칙 |
| :--- | :--- | :--- | :--- |
| `id` | `keyword` | - | 문서 UUID (OpenSearch 도큐먼트 `_id`와 동일) |
| `title` | `text` | **3 (boost: 3)** | 문서 제목 (검색 시 최우선 가중치 매칭) |
| `body` | `text` | **1 (boost: 1)** | 마크다운 원문 본문 (Frontmatter 제외 순수 텍스트) |
| `tags` | `keyword` | **2 (multi_match 시 tags^2)** | 소문자 정규화된 태그 키워드 배열 |
| `folderId` | `keyword` | - | 폴더 범위 제한 필터용 키워드 |
| `ownerId` | `keyword` | - | 사용자 소유권 격리 필터용 키워드 |
| `updatedAt` | `date` | - | 문서 최종 수정 일시 (ISO 8601 포맷) |

- **검색 및 하이라이트(Highlight) 설정**:
  - **검색 쿼리**: `multi_match` 쿼리 (`fields: ['title^3', 'tags^2', 'body^1']`, `fuzziness: 'AUTO'`)
  - **하이라이트 인코더**: `encoder: 'html'` (XSS 방지를 위한 HTML 특수문자 이스케이프)
  - **조각 크기(Fragment Size)**: `100` 글자
  - **조각 개수(Number of Fragments)**: 최대 `2`개
  - **스니펫 조합 규칙**: 본문 매칭 조각들을 ` ... ` 구분자로 연결하여 반환

---

### 1.4 인메모리 데이터 스토어 구조 (`apps/ai`)

#### 1) `AudioBufferStore` (LRU 음성 버퍼 캐시)
- **목적**: J.A.R.V.I.S.가 합성한 WAV 오디오 스트림을 임시 보관하고 클라이언트 다운로드/재생 엔드포인트에 고속 서빙
- **메모리 상한 용량**: 최대 `100MB` (`100 * 1024 * 1024` bytes)
- **기본 TTL**: `3600초` (1시간)
- **퇴출(Eviction) 정책**: 100MB 상한 도달 시 가장 오래 참조되지 않은 오디오 엔트리부터 즉시 폐기(LRU Map 방식)
- **저장 엔티티 (`StoredAudioEntry`) 필드 구조**:
  - `id`: `string` (형식: `speech-{UUID}`)
  - `ownerId`: `string` (선택, 사용자 소유권 검증 키)
  - `buffer`: `Buffer` (바이너리 오디오 스트림)
  - `format`: `string` (기본값: `'wav'`)
  - `mimeType`: `string` (기본값: `'audio/wav'`)
  - `createdAt`: `Date` (버퍼 생성 일시)
  - `expiresAt`: `Date` (버퍼 자동 만료 일시)

#### 2) `NeuralSessionService` (신경망 세션 인메모리 저장소)
- **목적**: 실시간 대화 및 SSE 스트리밍 세션의 생명주기와 상태 추적
- **저장 엔티티 (`NeuralSessionEntity`) 필드 구조**:
  - `id`: `string` (형식: `session-{UUID}`)
  - `ownerId`: `string` (소유자 식별자)
  - `title`: `string` (세션 제목, 기본값: `Neural Stream HH:mm:ss`)
  - `status`: `'LIVE' | 'idle' | 'saved'` (세션 진행 상태)
  - `createdAt`: `Date` (세션 개설 일시)
  - `updatedAt`: `Date` (최종 대화/상태 변경 일시)

---

## 2. 오브젝트 스토리지(MinIO) 및 메시지 큐(RabbitMQ) 계약 명세

### 2.1 MinIO 버킷 및 오브젝트 키(Path) 규격 (`libs/storage`)

| 버킷 식별자 | 기본 버킷명 | 저장 대상 리소스 |
| :--- | :--- | :--- |
| `docsBucket` | `my-space-markdown` | 마크다운 문서 최신 원문 및 과거 리비전 스냅샷 파일 |
| `assetsBucket` | `my-space-assets` | 마크다운 문서에 첨부된 이미지, 다이어그램 및 정적 미디어 |

#### 1) 오브젝트 키(Path) 템플릿
- **최신 문서 원본**:
  - `docs/{ownerId}/{documentId}/current.md`
  - `Content-Type`: `text/markdown; charset=utf-8`
- **문서 과거 리비전 스냅샷**:
  - `docs/{ownerId}/{documentId}/revisions/v{version}.md`
  - `Content-Type`: `text/markdown; charset=utf-8`
- **첨부 이미지 및 미디어 에셋**:
  - `images/{ownerId}/{randomUUID()}-{safeFilename}`
  - 특수문자가 언더스코어(`_`)로 치환된 안전한 원본 파일명 보존
  - `Content-Type`: 업로드 파일의 실제 감지된 MIME 타입 (PNG, JPEG, GIF, WebP, SVG)

#### 2) 에셋 서빙 시 응답 헤더 규칙 (`AssetController`)
- `Content-Type`: 파일의 실제 MIME 타입 (미확인 시 `application/octet-stream`)
- `Content-Length`: 에셋의 정확한 바이트 크기
- `X-Content-Type-Options`: `nosniff` (브라우저 MIME 스니핑 차단)
- `Content-Security-Policy`: `default-src 'none'; style-src 'unsafe-inline'; sandbox` (XSS 스크립트 실행 차단)
- `Cache-Control`: `private, max-age=86400` (개인 데이터 보호를 위한 공유 프록시 캐싱 차단 및 24시간 브라우저 로컬 캐시)
- `Content-Disposition`:
  - `image/svg+xml`: `attachment; filename="{filename}.svg"` (SVG 스크립트 실행 공격 방지를 위한 강제 다운로드)
  - 일반 이미지: `inline` (브라우저 마크다운 뷰어 내 즉시 렌더링)

---

### 2.2 RabbitMQ Exchange / Queue 및 메시지 페이로드 규격 (`libs/storage`)

#### 1) 브로커 토폴로지 설정

| 큐 / 익스체인지 이름 | 타입 / 역할 | 내구성(durable) | 설정 아규먼트(Arguments) | 라우팅 규칙 |
| :--- | :--- | :--- | :--- | :--- |
| `markdown-indexing-queue.dlx` | Direct Exchange | `true` | 없음 | 교착 메시지 전용 분기 익스체인지 |
| `markdown-indexing-queue.dlq` | Dead Letter Queue | `true` | 없음 | `markdown-indexing-queue.dlx`에 바인딩 키 `'dead'`로 연결 |
| `markdown-indexing-queue.retry` | 지연 재시도 큐 | `true` | `x-message-ttl: 5000`<br>`x-dead-letter-exchange: ""` (Default)<br>`x-dead-letter-routing-key: markdown-indexing-queue` | 5초 경과 시 원본 메인 큐로 자동 재투입 |
| `markdown-indexing-queue` | 메인 워커 큐 | `true` | `x-dead-letter-exchange: markdown-indexing-queue.dlx`<br>`x-dead-letter-routing-key: dead` | 3회 재시도 초과 또는 JSON 파싱 불가 시 DLX로 nack |

#### 2) 발행 메시지 페이로드 규격

- **색인 이벤트 (`DocumentIndexEvent`)**:
  - `type`: `'INDEX'` (문자열 리터럴, 필수)
  - `documentId`: `string` (문서 UUID, 필수)
  - `ownerId`: `string` (소유자 ID, 필수)
  - `version`: `number` (색인 대상 버전 번호, 필수)
  - `title`: `string` (문서 제목, 필수)
  - `folderId`: `string | null` (소속 폴더 ID, 선택)
  - `tags`: `string[]` (태그 목록, 선택)
  - `timestamp`: `string` (발행 시각 ISO 8601, 필수)

- **삭제 이벤트 (`DocumentDeleteEvent`)**:
  - `type`: `'DELETE'` (문자열 리터럴, 필수)
  - `documentId`: `string` (문서 UUID, 필수)
  - `ownerId`: `string` (소유자 ID, 필수)
  - `timestamp`: `string` (발행 시각 ISO 8601, 필수)

#### 3) 메시지 헤더 및 분산 추적 규격
- `x-attempt`: `number` (소비 시도 횟수, 최초 발행 시 `1`, 실패 후 재시도 시 `2 -> 3`, 3 초과 시 DLQ 라우팅)
- `x-request-id`: `string` (HTTP 요청의 원본 식별자, 워커 비동기 처리 시 로그 컨텍스트 복원)
- `x-trace-id`: `string` (W3C 분산 트레이스 ID)
- `traceparent`: `string` (W3C 분산 추적 표준 헤더 포맷)

---

## 3. 전체 REST API 및 SSE 엔드포인트 카탈로그

백엔드 애플리케이션(`apps/api`, `apps/ai`, `libs/common`)에 선언된 15개 컨트롤러의 모든 엔드포인트 명세입니다.

### 3.1 시스템 상태 및 인증 (System & Auth)

| 도메인 | HTTP 메서드 & 경로 | 인증 여부 | Request 규격 (Params / Query / Body) | Response 규격 (상태 코드 및 반환 구조) |
| :--- | :--- | :--- | :--- | :--- |
| **System** | `GET /health` | `@Public()` (공개) | 없음 | **200 OK**: `{ status: 'ok', timestamp: string, uptime: number, memory: { heapUsed: string, rss: string }, environment: string }` |
| **System** | `GET /health/ready` | `@Public()` (공개) | 없음 | **200 OK** (정상) / **503 Service Unavailable** (의존성 장애): `{ status: 'ok' \| 'error', timestamp: string, checks: { database: { status: string, latencyMs?: number, message?: string }, rabbitmq: { ... }, minio: { ... }, opensearch: { ... }, qdrant: { ... } } }` |
| **System** | `GET /version`<br>`GET /api/v1/version` | `@Public()` (공개) | 없음 | **200 OK**: `{ version: string, gitBranch: string, gitCommit: string, gitCommitDate: string, buildTime: string, environment: string }` |
| **Root** | `GET /` | `@Public()` (공개) | 없음 | **200 OK**: `string` (`"Hello World!"`) |
| **Auth** | `GET /api/v1/auth/me` | **인증 필수** (`RemoteUserGuard`) | 없음 (헤더 주입: `Remote-User`, `Remote-Name`, `Remote-Email`, `Remote-Groups`) | **200 OK**: `{ username: string, name?: string, email?: string, groups: string[] }`<br>**401 Unauthorized**: 인증 헤더 누락 시 |

---

### 3.2 마크다운 폴더 (Markdown Folders)

| 도메인 | HTTP 메서드 & 경로 | 인증 여부 | Request 규격 (Params / Query / Body) | Response 규격 (상태 코드 및 반환 구조) |
| :--- | :--- | :--- | :--- | :--- |
| **Folder** | `GET /api/v1/markdown/folders` | **인증 필수** | 없음 | **200 OK**: `FolderResponseDto[]` (`[{ id: string, name: string, parentId: string \| null, createdAt: string, updatedAt: string, children: FolderResponseDto[] }]`) |
| **Folder** | `POST /api/v1/markdown/folders` | **인증 필수** | **Body (`CreateFolderDto`)**:<br>- `name`: `string` (필수, 1~100자)<br>- `parentId`: `string` (UUID, 선택/nullable) | **201 Created**: `FolderResponseDto`<br>**409 Conflict**: 동일 부모 내 동일 이름 폴더 존재 시 |
| **Folder** | `PATCH /api/v1/markdown/folders/:id` | **인증 필수** | **Param**: `id` (string, UUID)<br>**Body (`UpdateFolderDto`)**:<br>- `name`: `string` (선택, 1~100자)<br>- `parentId`: `string` (UUID, 선택/nullable) | **200 OK**: `FolderResponseDto`<br>**400 Bad Request**: 자기 자신 또는 하위 폴더로 이동 시 (`FOLDER_CYCLIC_DEPENDENCY`)<br>**404 Not Found**: 대상 폴더 없음 |
| **Folder** | `DELETE /api/v1/markdown/folders/:id` | **인증 필수** | **Param**: `id` (string, UUID) | **204 No Content**: 본문 없음 (하위 폴더 함께 삭제, 문서는 미분류 전환)<br>**404 Not Found**: 폴더 없음 |

---

### 3.3 마크다운 문서 및 가져오기/내보내기 (Markdown Documents)

| 도메인 | HTTP 메서드 & 경로 | 인증 여부 | Request 규격 (Params / Query / Body) | Response 규격 (상태 코드 및 반환 구조) |
| :--- | :--- | :--- | :--- | :--- |
| **Document** | `POST /api/v1/markdown/documents` | **인증 필수** | **Body (`CreateDocumentDto`)**:<br>- `title`: `string` (필수, 1~255자)<br>- `content`: `string` (선택, 기본값 `""`)<br>- `folderId`: `string` (UUID, 선택/nullable)<br>- `tags`: `string[]` (선택, 기본값 `[]`)<br>- `frontmatter`: `object` (선택) | **201 Created**: `DocumentDetailDto` (`{ id: string, title: string, folderId: string \| null, folderName: string \| null, tags: string[], currentVersion: number, createdAt: string, updatedAt: string, content: string, frontmatter: object }`) |
| **Document** | `GET /api/v1/markdown/documents` | **인증 필수** | **Query (`DocumentQueryDto`)**:<br>- `folderId`: `string` (UUID, 선택)<br>- `tag`: `string` (선택)<br>- `page`: `number` (기본값 1)<br>- `limit`: `number` (기본값 20, 최대 100)<br>- `cursor`: `string` (UUID, 커서 페이징 기준 문서 ID) | **200 OK**: `{ total: number, page: number, limit: number, items: DocumentListItemDto[], nextCursor: string \| null }` |
| **Document** | `GET /api/v1/markdown/documents/:id` | **인증 필수** | **Param**: `id` (string, UUID) | **200 OK**: `DocumentDetailDto`<br>**404 Not Found**: 문서 없음 |
| **Document** | `PUT /api/v1/markdown/documents/:id` | **인증 필수** | **Param**: `id` (string, UUID)<br>**Header**: `If-Match` (선택, 낙관적 잠금 버전 번호)<br>**Body (`UpdateDocumentDto`)**:<br>- `title`: `string` (선택, 1~255자)<br>- `content`: `string` (선택)<br>- `folderId`: `string` (UUID, 선택/nullable)<br>- `tags`: `string[]` (선택)<br>- `frontmatter`: `object` (선택)<br>- `expectedVersion`: `number` (선택) | **200 OK**: `DocumentDetailDto`<br>**404 Not Found**: 문서 없음<br>**409 Conflict**: 기대 버전 불일치 (`DOCUMENT_VERSION_CONFLICT`) |
| **Document** | `DELETE /api/v1/markdown/documents/:id` | **인증 필수** | **Param**: `id` (string, UUID) | **204 No Content**: 본문 없음 (MinIO 및 OpenSearch 색인 정리)<br>**404 Not Found**: 문서 없음 |
| **Document** | `POST /api/v1/markdown/documents/import` | **인증 필수** | **Form-Data (`multipart/form-data`)**:<br>- `file`: 바이너리 `.md` 파일 (필수, 최대 10MB)<br>- `folderId`: `string` (선택, 폼 필드) | **201 Created**: `DocumentDetailDto`<br>**400 Bad Request**: 비어있는 파일 또는 비정상 포맷 |
| **Document** | `GET /api/v1/markdown/documents/:id/export/md` | **인증 필수** | **Param**: `id` (string, UUID) | **200 OK**: 바이너리/텍스트 스트림 (`text/markdown; charset=utf-8`), `Content-Disposition: attachment; filename="{title}.md"` |
| **Document** | `GET /api/v1/markdown/documents/:id/export/pdf` | **인증 필수** | **Param**: `id` (string, UUID) | **200 OK**: PDF 바이너리 스트림 (`application/pdf`), `Content-Disposition: attachment; filename="{title}.pdf"` |

---

### 3.4 마크다운 리비전 및 이력 (Markdown Revisions)

| 도메인 | HTTP 메서드 & 경로 | 인증 여부 | Request 규격 (Params / Query / Body) | Response 규격 (상태 코드 및 반환 구조) |
| :--- | :--- | :--- | :--- | :--- |
| **Revision** | `GET /api/v1/markdown/documents/:documentId/revisions` | **인증 필수** | **Param**: `documentId` (string, UUID) | **200 OK**: `RevisionListItemDto[]` (`[{ version: number, title: string, createdAt: string, isCurrent: boolean }]`) |
| **Revision** | `GET /api/v1/markdown/documents/:documentId/revisions/compare` | **인증 필수** | **Param**: `documentId` (string, UUID)<br>**Query**: `targetVersion` (필수, `number`) | **200 OK**: `RevisionCompareDto` (`{ baseVersion: number, baseContent: string, targetVersion: number, targetContent: string }`) |
| **Revision** | `GET /api/v1/markdown/documents/:documentId/revisions/:version` | **인증 필수** | **Param**:<br>- `documentId`: `string` (UUID)<br>- `version`: `number` (정수) | **200 OK**: `RevisionDetailDto` (`{ version: number, title: string, content: string, createdAt: string }`)<br>**404 Not Found**: 해당 리비전 없음 |
| **Revision** | `POST /api/v1/markdown/documents/:documentId/revisions/:version/restore` | **인증 필수** | **Param**:<br>- `documentId`: `string` (UUID)<br>- `version`: `number` (정수) | **200 OK**: `DocumentDetailDto` (해당 시점 내용으로 신규 버전이 생성되어 복원됨) |

---

### 3.5 마크다운 태그, 에셋 및 검색 (Tags, Assets & Search)

| 도메인 | HTTP 메서드 & 경로 | 인증 여부 | Request 규격 (Params / Query / Body) | Response 규격 (상태 코드 및 반환 구조) |
| :--- | :--- | :--- | :--- | :--- |
| **Tag** | `GET /api/v1/markdown/tags` | **인증 필수** | 없음 | **200 OK**: `TagResponseDto[]` (`[{ id: string, name: string, documentCount: number }]`) |
| **Asset** | `POST /api/v1/markdown/assets/upload` | **인증 필수** | **Form-Data (`multipart/form-data`)**:<br>- `file`: 이미지 파일 (필수, 최대 10MB, PNG/JPEG/GIF/WebP/SVG 허용) | **201 Created**: `AssetUploadResponseDto` (`{ url: string, key: string, filename: string, size: number, contentType: string }`)<br>**400 Bad Request**: 허용되지 않은 파일 형식/크기 초과 |
| **Asset** | `GET /api/v1/markdown/assets/*key` | **인증 필수** | **Param**: `key` (와일드카드 경로, 소유자 격리 검증: `images/{ownerId}/...`) | **200 OK**: 미디어 바이너리 스트림 (보안 헤더 `X-Content-Type-Options: nosniff`, `CSP`, SVG는 강제 다운로드 서빙)<br>**403 Forbidden**: 타인 에셋 접근 시<br>**404 Not Found**: 에셋 없음 |
| **Search** | `GET /api/v1/markdown/search` | **인증 필수** | **Query (`SearchQueryDto`)**:<br>- `q`: `string` (검색어, 기본값 `""`)<br>- `folderId`: `string` (UUID, 선택)<br>- `tag`: `string` (선택)<br>- `page`: `number` (기본값 1)<br>- `limit`: `number` (기본값 20, 최대 100)<br>*(제약: `page * limit <= 10000`)* | **200 OK**: `SearchResponseDto` (`{ total: number, page: number, limit: number, items: [{ id: string, title: string, tags: string[], folderId: string \| null, updatedAt: string, score: number, snippet?: string }] }`) |

---

### 3.6 PDF 유틸리티 (PDF Utilities)

모든 PDF 요청은 `RemoteUserGuard` 인증이 적용되며, 1개 파일당 최대 50MB 상한이 적용됩니다.

| 도메인 | HTTP 메서드 & 경로 | 인증 여부 | Request 규격 (Params / Query / Body) | Response 규격 (상태 코드 및 반환 구조) |
| :--- | :--- | :--- | :--- | :--- |
| **PDF** | `POST /api/v1/pdf/inspect` | **인증 필수** | **Form-Data (`multipart/form-data`)**:<br>- `file`: PDF 파일 (필수, 최대 50MB)<br>- `password`: `string` (선택) | **200 OK**: `InspectPdfResponseDto` (`{ isEncrypted: boolean, isPasswordValid?: boolean, pageCount?: number, metadata?: { title?: string, author?: string, creator?: string, producer?: string, creationDate?: Date, modificationDate?: Date } }`)<br>**422 Unprocessable**: 손상된 PDF |
| **PDF** | `POST /api/v1/pdf/unlock` | **인증 필수** | **Form-Data (`multipart/form-data`)**:<br>- `file`: PDF 파일 (필수, 최대 50MB)<br>- `password`: `string` (필수) | **200 OK**: 바이너리 스트림 (`application/pdf`), `Content-Disposition: attachment; filename="unlocked.pdf"`<br>**400 Bad Request**: 비밀번호 불일치 또는 암호화되지 않은 PDF |
| **PDF** | `POST /api/v1/pdf/merge` | **인증 필수** | **Form-Data (`multipart/form-data`)**:<br>- `files`: PDF 파일 배열 (필수, 2~20개, 총합 100MB 이내)<br>- `passwords`: `string` (선택, JSON 배열 문자열 예: `["pw1", ""]`) | **200 OK**: 바이너리 스트림 (`application/pdf`), `Content-Disposition: attachment; filename="merged.pdf"`<br>**400 Bad Request**: 파일 2개 미만/20개 초과, 비밀번호 누락 |
| **PDF** | `POST /api/v1/pdf/split/range` | **인증 필수** | **Form-Data (`multipart/form-data`)**:<br>- `file`: PDF 파일 (필수, 최대 50MB)<br>- `ranges`: `string` (필수, 예: `'1-3, 5, 8-10'`)<br>- `password`: `string` (선택) | **200 OK**: 바이너리 스트림 (`application/pdf`), `Content-Disposition: attachment; filename="extracted.pdf"`<br>**400 Bad Request**: 잘못된 페이지 범위 표기 또는 페이지 수 초과 |
| **PDF** | `POST /api/v1/pdf/split/all` | **인증 필수** | **Form-Data (`multipart/form-data`)**:<br>- `file`: PDF 파일 (필수, 최대 50MB)<br>- `password`: `string` (선택) | **200 OK**: ZIP 압축 아카이브 스트림 (`application/zip`), `Content-Disposition: attachment; filename="split-pages.zip"` |

---

### 3.7 AI 세션, 음성 및 채팅 (AI Workspace & Voice Core)

| 도메인 | HTTP 메서드 & 경로 | 인증 여부 | Request 규격 (Params / Query / Body) | Response 규격 (상태 코드 및 반환 구조) |
| :--- | :--- | :--- | :--- | :--- |
| **AI Session** | `GET /api/v1/ai/sessions` | **인증 필수** | 없음 | **200 OK**: `NeuralStreamSessionDto[]` (`[{ id: string, title: string, status: 'LIVE' \| 'idle' \| 'saved', createdAt: string, updatedAt: string }]`) |
| **AI Session** | `POST /api/v1/ai/sessions` | **인증 필수** | **Body (`CreateNeuralSessionDto`)**:<br>- `title`: `string` (선택, 최대 100자) | **201 Created**: `NeuralStreamSessionDto` |
| **AI Voice** | `POST /api/v1/ai/voice/stream` | **인증 필수** | **Multipart 또는 JSON**:<br>- `sessionId`: `string` (필수)<br>- `textQuery`: `string` (선택)<br>- `enableTools`: `boolean` (선택, 기본값 `true`)<br>- `audio`: 오디오 바이너리 파일 (선택, 최대 25MB)<br>- `voiceSettings`: `{ selectedVoice?: string, speechSpeed?: number, enableTelemetry?: boolean }` (선택) | **200 OK (SSE 실시간 스트림)**:<br>`Content-Type: text/event-stream`<br>- `event: stt_progress` / `data: { recognizedText }`<br>- `event: token` / `data: { delta }`<br>- `event: telemetry` / `data: BenchmarkDeltaMetricsDto`<br>- `event: context` / `data: ReferencedContextDto[]`<br>- `event: audio_ready` / `data: AudioCompleteDto`<br>- `event: done` / `data: StreamDoneDto`<br>- `event: error` / `data: { code }` |
| **AI Voice** | `POST /api/v1/ai/chat/interrupt` | **인증 필수** | **Body (`InterruptQueryDto`)**:<br>- `sessionId`: `string` (필수)<br>- `streamId`: `string` (선택) | **200 OK**: `{ status: 'ok', interrupted: boolean }` |
| **AI Voice** | `GET /api/v1/ai/audio/:id` | **인증 필수** | **Param**: `id` (string, 오디오 식별자 예: `speech-xxx.wav`) | **200 OK**: 바이너리 오디오 스트림 (`Content-Type: audio/wav`, `Cache-Control: private, max-age=3600`)<br>**404 Not Found**: 오디오 만료/없음 |
| **AI Chat** | `POST /api/v1/ai/chat` | **인증 필수** | **Body (`AiChatDto`)**:<br>- `messages`: `[{ role: 'user' \| 'assistant', content: string }]` (필수, 1~50개, 본문 최대 8000자)<br>- `provider`: `'gemini' \| 'ollama'` (선택, 기본값 `'gemini'`)<br>- `enableTools`: `boolean` (선택, 기본값 `true`) | **200 OK**: `AiChatResponseDto` (`{ message: { role: 'assistant', content: string }, toolExecutions?: [{ name: string, args: object, result?: string }] }`) |
| **AI Chat** | `POST /api/v1/ai/chat/stream` | **인증 필수** | **Body (`AiChatDto`)**: 상동 | **200 OK (SSE 실시간 스트림)**:<br>`Content-Type: text/event-stream`<br>- `event: token` / `data: { token }`<br>- `event: tool_call` / `data: { tool, args }`<br>- `event: tool_result` / `data: { tool, result }`<br>- `event: done` / `data: { fullContent }`<br>- `event: error` / `data: { code }` |
| **AI Search** | `POST /api/v1/ai/search` | **인증 필수** | **Body (`AiSearchDto`)**:<br>- `query`: `string` (필수, 자연어 질의)<br>- `limit`: `number` (기본값 5, 1~20)<br>- `folderId`: `string` (선택)<br>- `tags`: `string[]` (선택) | **200 OK**: `AiSearchResponseDto` (`{ total: number, results: [{ documentId: string, title: string, heading: string, content: string, score: number, tags?: string[] }] }`) |

---

## 4. 전역 에러 응답 규격 (RFC 7807) 및 에러 코드 전체 사전

### 4.1 RFC 7807 Problem Details 응답 페이로드 명세 (`libs/common`)

백엔드의 모든 컨트롤러에서 발생하는 예외는 `AllExceptionsFilter`에 의해 인터셉트되어 `application/problem+json` 미디어 타입의 표준 규격으로 정규화됩니다.

| 필드명 | 데이터 타입 | 필수 여부 | 설명 | 예시 값 |
| :--- | :--- | :--- | :--- | :--- |
| `type` | `string` (URI) | 필수 | 에러 유형을 고유하게 식별하는 URI | `"https://api.myspace.local/errors/pdf-invalid-password"` |
| `title` | `string` | 필수 | HTTP 상태 코드에 대응하는 공식 상태 제목 | `"Bad Request"`, `"Not Found"`, `"Conflict"` |
| `status` | `number` | 필수 | HTTP 응답 상태 코드 | `400`, `404`, `409`, `422` |
| `detail` | `string` | 필수 | 사람이 읽을 수 있는 구체적인 비즈니스 오류 메시지 | `"PDF 비밀번호가 일치하지 않습니다."` |
| `instance` | `string` | 필수 | 오류가 발생한 API 엔드포인트 요청 경로 | `"/api/v1/pdf/unlock"` |
| `code` | `string` | 필수 | 비즈니스/도메인 에러 식별 코드 | `"PDF_INVALID_PASSWORD"` |
| `traceId` | `string` | 선택 | 분산 추적 요청 ID (`x-request-id` 또는 `traceparent`) | `"req-67890-abcd-ef01"` |
| `timestamp` | `string` | 필수 | 에러 발생 일시 (ISO 8601 포맷) | `"2026-10-18T09:30:00.000Z"` |
| `details` | `object` | 선택 | 입력 유효성 실패 필드 및 부가 메타데이터 객체 | `{ "field": "password", "constraint": "min" }` |
| `stack` | `string` | 조건부 | 스택 트레이스 (로컬 환경 `IS_LOCAL=true`인 경우에만 노출) | `"Error: ...\n    at ..."` |
| `statusCode` | `number` | 레거시 | 기존 프론트엔드 및 E2E 테스트 호환성을 위한 상태 코드 | `400` |
| `message` | `string` | 레거시 | 기존 호환성을 위한 에러 메시지 | `"PDF 비밀번호가 일치하지 않습니다."` |
| `path` | `string` | 레거시 | 기존 호환성을 위한 요청 경로 | `"/api/v1/pdf/unlock"` |

---

### 4.2 도메인 에러 코드 전체 사전 (`DOMAIN_ERROR_HTTP_MAP` 전수 명세)

아래 표는 `libs/common/src/filters/domain-error-http.map.ts` 및 하위 도메인 예외 클래스에 선언된 32대 표준 에러 코드와 기본 매핑 규칙 전수 목록입니다.

| 도메인 | 에러 코드 (`code`) | HTTP 상태 코드 | 기본 에러 메시지 및 발생 조건 |
| :--- | :--- | :--- | :--- |
| **Auth / Security** | `AUTH_UNAUTHORIZED` | **401 Unauthorized** | 인증 정보가 누락되었거나 유효하지 않음 (`Remote-User` 헤더 누락 등) |
| **Auth / Security** | `TOKEN_EXPIRED` | **401 Unauthorized** | 인증 토큰 만료 |
| **Auth / Security** | `ACCESS_DENIED` | **403 Forbidden** | 해당 리소스에 대한 접근 권한 거부 |
| **Auth / Security** | `FORBIDDEN_OPERATION` | **403 Forbidden** | 정책상 금지된 작업 수행 시도 |
| **Common Resource** | `RESOURCE_NOT_FOUND` | **404 Not Found** | 요청한 일반 리소스를 찾을 수 없음 |
| **Common Resource** | `RESOURCE_ALREADY_EXISTS` | **409 Conflict** | 동일 식별자의 리소스가 이미 존재함 |
| **Common Request** | `INVALID_INPUT` | **400 Bad Request** | 클라이언트 입력 파라미터 유효성 검증 실패 |
| **Common Request** | `MALFORMED_DATA` | **400 Bad Request** | 요청 데이터의 형식이나 구조가 올바르지 않음 |
| **Common Infra** | `DATABASE_CONNECTION_ERROR` | **500 Internal Server Error** | 데이터베이스 연결 풀 장애 또는 쿼리 실패 |
| **Common Infra** | `EXTERNAL_API_ERROR` | **500 Internal Server Error** | 외부 서드파티 통신 중 오류 발생 |
| **PDF Utility** | `PDF_PASSWORD_REQUIRED` | **400 Bad Request** | 암호화된 PDF이나 요청 시 비밀번호가 누락됨 |
| **PDF Utility** | `PDF_INVALID_PASSWORD` | **400 Bad Request** | 입력된 PDF 비밀번호가 일치하지 않음 |
| **PDF Utility** | `PDF_NOT_PASSWORD_PROTECTED` | **400 Bad Request** | 암호 해제 대상 파일이 암호화되어 있지 않은 일반 PDF임 |
| **PDF Utility** | `PDF_MIN_FILE_COUNT_NOT_MET` | **400 Bad Request** | PDF 병합을 위해 최소 2개 이상의 파일이 필요하나 미달됨 |
| **PDF Utility** | `PDF_MAX_FILE_COUNT_EXCEEDED` | **400 Bad Request** | 1회 병합 요청 한도(20개)를 초과함 |
| **PDF Utility** | `PDF_FILE_SIZE_EXCEEDED` | **413 Payload Too Large** | 파일당 용량 한도(50MB) 또는 총합 용량(100MB)을 초과함 |
| **PDF Utility** | `PDF_INVALID_PAGE_RANGE` | **400 Bad Request** | 페이지 범위 구문 오류 또는 문서 전체 페이지 수를 초과하는 범위 지정 |
| **PDF Utility** | `PDF_CORRUPTED_FILE` | **422 Unprocessable Entity** | 손상되었거나 표준 PDF 규격을 준수하지 않는 파일 |
| **Markdown Knowledge** | `FOLDER_NOT_FOUND` | **404 Not Found** | 지정한 폴더가 존재하지 않거나 타인의 폴더에 접근 시도 |
| **Markdown Knowledge** | `FOLDER_ALREADY_EXISTS` | **409 Conflict** | 동일 부모 폴더 내에 동일한 폴더명이 이미 존재함 |
| **Markdown Knowledge** | `FOLDER_CYCLIC_DEPENDENCY` | **400 Bad Request** | 폴더 이동 시 자기 자신 또는 하위 자식 폴더로 이동 시도 |
| **Markdown Knowledge** | `DOCUMENT_NOT_FOUND` | **404 Not Found** | 지정한 문서를 찾을 수 없거나 타인의 문서에 접근 시도 |
| **Markdown Knowledge** | `DOCUMENT_VERSION_CONFLICT` | **409 Conflict** | 낙관적 동시성 충돌 발생 (다른 요청에 의해 현재 버전이 변경됨) |
| **Markdown Knowledge** | `REVISION_NOT_FOUND` | **404 Not Found** | 문서의 지정한 과거 리비전 스냅샷이 존재하지 않음 |
| **Markdown Knowledge** | `INVALID_ASSET_FILE` | **400 Bad Request** | 지원하지 않는 이미지 확장자(MIME)이거나 파일 내용 손상 |
| **Markdown Knowledge** | `ASSET_ACCESS_DENIED` | **403 Forbidden** | 에셋 경로가 `images/{ownerId}/` 규격을 벗어난 타인 에셋 접근 시도 |
| **Markdown Knowledge** | `ASSET_NOT_FOUND` | **404 Not Found** | MinIO 에셋 버킷에서 지정한 키를 찾을 수 없음 |
| **Markdown Knowledge** | `INVALID_MARKDOWN_FILE` | **400 Bad Request** | 가져오기한 마크다운 파일 내용이 비어있거나 올바르지 않음 |
| **Markdown Knowledge** | `STORAGE_OBJECT_NOT_FOUND` | **404 Not Found** | MinIO 문서 버킷 내 원본 오브젝트 파일이 누락됨 |
| **Markdown Knowledge** | `MARKDOWN_UNSAFE_FRONTMATTER` | **400 Bad Request** | Frontmatter 내 허용되지 않는 JS/Coffee 스크립트 엔진 감지 |
| **Markdown Knowledge** | `SEARCH_SERVICE_UNAVAILABLE` | **503 Service Unavailable** | OpenSearch 검색 엔진 서비스 장애 또는 타임아웃 |
| **AI / Voice Core** | `AI_SESSION_NOT_FOUND` | **404 Not Found** | 신경망 스트림 대화 세션을 찾을 수 없음 |
| **AI / Voice Core** | `AI_SESSION_INACTIVE` | **422 Unprocessable Entity** | 이미 종료되거나 비활성화된 신경망 세션에 요청 시도 |
| **AI / Voice Core** | `AI_AUDIO_NOT_FOUND` | **404 Not Found** | 합성 오디오 ID를 찾을 수 없거나 TTL(1시간) 만료로 폐기됨 |
| **AI / Voice Core** | `AI_AUDIO_PAYLOAD_TOO_LARGE` | **413 Payload Too Large** | 음성 입력 파일 용량이 허용 상한(25MB)을 초과함 |
| **AI / Voice Core** | `AI_AUDIO_INVALID_FORMAT` | **400 Bad Request** | 지원하지 않는 오디오 포맷 전송 (WAV, WebM 외 포맷) |
| **AI / Voice Core** | `AI_STT_FAILED` | **502 Bad Gateway** | 외부 또는 로컬 음성 인식(STT) 엔진 변환 실패 |
| **AI / Voice Core** | `AI_TTS_FAILED` | **502 Bad Gateway** | Piper / 외부 음성 합성(TTS) 파이프라인 실패 |
| **AI / Voice Core** | `AI_STREAM_NOT_FOUND` | **404 Not Found** | 중단(`interrupt`)할 활성 SSE 스트림이 존재하지 않음 |
| **AI / Voice Core** | `AI_TOOL_NOT_FOUND` | **404 Not Found** | AI 에이전트가 지원하지 않는 도구 함수를 호출함 |
| **기본 처리 규칙** | *(매핑되지 않은 도메인 예외)* | **422 Unprocessable Entity** | `DEFAULT_DOMAIN_HTTP_STATUS` 적용 (비즈니스 규칙 위반 자동 폴백) |
| **인프라 예외 자동 매핑** | `DATABASE_UNIQUE_CONFLICT` | **409 Conflict** | Prisma P2002 에러 가로채기 자동 변환 |
| **인프라 예외 자동 매핑** | `DATABASE_RECORD_NOT_FOUND` | **404 Not Found** | Prisma P2025 에러 가로채기 자동 변환 |
| **인프라 예외 자동 매핑** | `LIMIT_FILE_SIZE` | **413 Payload Too Large** | Multer 파일 크기 한도 초과 가로채기 자동 변환 |
