---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-06
---

# AI Workspace 도메인 사양서 (AI Workspace Specification)

## 1. 개요 (Summary)
개인 맞춤형 AI Assistant를 제공하는 독립 서버(`apps/ai`) 도메인 사양서입니다.  
사용자의 마크다운 문서를 비동기로 청킹/임베딩하여 Qdrant에 저장하고, Gemini 3.8 Flash 및 Ollama(qwen3.5:0.8b)를 활용하여 일반 대화, 개인 문서 기반 질의응답(RAG), Function Calling(문서 검색/열람/마크다운 저장), 그리고 Server-Sent Events (SSE) 실시간 스트리밍을 제공합니다.

---

## 2. 목표 및 비목표 (Goals / Non-goals)

### 목표 (Goals)
* **모노레포 독립 서버**: `apps/ai` (포트 3001)로 메인 API와 프로세스를 격리하여 배포 및 장애 전파 방지
* **비동기 인덱싱 파이프라인**: RabbitMQ 메시지 큐(`markdown-indexing-queue`)를 구독하여 문서 변경 시 백그라운드에서 Qdrant 768차원 컬렉션(`personal-documents`) 동기화
* **의미론적 청킹**: 헤딩, 코드 블록, 표, 수식이 깨지지 않도록 마크다운 구조 보존 분할 (500~800자)
* **멀티 AI Provider**:
  * 운영: Google Gemini (`gemini-3.8-flash` / `text-embedding-004`, 768차원)
  * 테스트/로컬: Ollama (`qwen3.5:0.8b` / `nomic-embed-text`, 768차원)
* **Tool Calling 3종**:
  * `search_my_documents`: Qdrant 시맨틱 검색
  * `read_document`: 본인 문서 원문 로드
  * `save_to_markdown`: AI 응답을 신규 마크다운 문서로 저장
* **대화 스트리밍**: SSE (`text/event-stream`) 실시간 토큰 전송 및 단발성 JSON 응답 동시 지원
* **소유자 격리 및 프롬프트 인젝션 방어**: `ownerId` 기반 벡터 필터링 강제 및 `<untrusted_document_context>` 샌드박싱

### 제외 대상 (Non-goals)
* 외부 웹 검색 (Web Research)
* OpenSearch + Qdrant 결합 RRF 하이브리드 검색
* 대화 세션/히스토리 DB 영구 보관 (클라이언트가 messages 배열을 전달)
* 다중 파일 멀티모달 Vision 분석

---

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-A01` | 사용자 | 개인 문서 시맨틱 검색 | 검색 질의어를 임베딩하고 Qdrant에서 본인 소유의 관련 문서 청크 목록을 유사도 순으로 조회 |
| `UC-A02` | 사용자 | AI 질의응답 (RAG 대화) | LLM과 대화하며, 필요 시 AI가 문서를 검색하여 컨텍스트를 참조한 뒤 답변 생성 |
| `UC-A03` | 사용자 | 실시간 SSE 스트리밍 대화 | AI 응답 생성 과정을 끊김 없이 토큰 단위로 실시간 수신 |
| `UC-A04` | 시스템 | 비동기 문서 인덱싱 | 메인 API에서 문서 생성/수정/삭제 시 RabbitMQ 이벤트를 수신하여 Qdrant 벡터 색인 자동 갱신 |
| `UC-A05` | AI/사용자 | 대화 결과 마크다운 저장 | AI가 정리한 답변이나 지식을 Tool Calling을 통해 기존 마크다운 서비스에 신규 문서로 저장 |

---

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-A01` (사용자 격리)**:
  * Qdrant 검색 시 항상 `filter: { must: [{ key: "ownerId", match: { value: ownerId } }] }` 조건이 강제 적용되어 타인의 문서를 절대 검색할 수 없다.
* **`BR-A02` (원자적 색인, 멱등 ID 및 Zero-Downtime Upsert)**:
  * 문서 청크 ID는 `uuid-v5(documentId:chunkIndex)`로 결정적(Deterministic)으로 생성하여 재시도나 중복 메시지 수신 시에도 동일 포인트를 덮어쓰는 멱등성을 보장한다.
  * 검색 공백(Downtime) 및 색인 증발을 방지하기 위해 신규 버전 청크 포인트를 먼저 Upsert하고, 업서트 성공 후에만 구버전(`version < currentVersion`) 잔여 포인트를 선택적으로 삭제한다.
  * 청크 임베딩은 전체 청크에 대해 원자적(All-or-Nothing)으로 수행되며, 일부 실패 시 부분 인덱스를 남기지 않고 전체 실패로 처리하여 브로커 재시도로 위임한다.
  * Qdrant에 이미 더 높은 최신 버전이 색인되어 있는 경우, 지연 도착한 과거 버전의 이벤트는 색인을 수행하지 않고 안전하게 무시한다.
* **`BR-A03` (청크 무결성 보존)**:
  * 코드 블록(```)이나 테이블은 청크 중간에 잘리지 않아야 하며, 각 청크에는 소속 상위 헤딩 정보가 메타데이터로 첨부되어야 한다.
* **`BR-A04` (Prompt Injection 방어)**:
  * 검색된 문서 청크는 시스템 프롬프트 내에 격리 태그(`<untrusted_document_context>`)로 묶이며, 시스템 지시어로 해석되지 않도록 처리된다.
* **`BR-A05` (Tool 권한 제한)**:
  * AI가 실행하는 모든 도구는 요청자의 `ownerId` 권한 범위 내에서만 동작하며, 임의의 API를 호출할 수 없다.
* **`BR-A06` (CORS 및 브라우저 교차 출처 요청 위조 방어)**:
  * AI 서버는 임의의 Origin 반사(`origin: true`)를 엄격히 금지하고, 화이트리스트(`defaultOrigins` + `app.corsOrigins`)에 등록된 신뢰 출처만 허용한다.
  * 브라우저 CORS 요청 헤더(`allowedHeaders`)에서 `Remote-*` 계열의 프록시 헤더를 원천 배제하여 외부 악성 스크립트에 의한 인증 헤더 조작 및 CSRF를 방지한다.
* **`BR-A07` (메시지 브로커 신뢰성, 재시도 및 DLQ)**:
  * RabbitMQ 브로커와의 연결 유실 시 지수 백오프 기반으로 자동 재연결되어야 하며, 연결 복구 시 등록된 Consumer가 자동으로 복원되어야 한다.
  * 일시적인 인덱싱 실패(MinIO/네트워크 지연 등) 시 최대 3회까지 지연 재시도 큐(`markdown-indexing-queue.retry`)를 통해 재시도한다.
  * 최대 재시도 초과 또는 역직렬화 불가 메시지는 즉시 Dead Letter Exchange(`markdown-indexing-queue.dlx`)를 통해 Dead Letter Queue(`markdown-indexing-queue.dlq`)로 안전하게 격리 보존되어 메시지 영구 소실을 방지한다.
  * 인덱싱 워커는 MinIO 원문 로드 실패 등의 예외를 내부에서 삼키지 않고 브로커로 전파하여 재시도/DLQ 메커니즘을 유발해야 한다.
* **`BR-A08` (SSE 스트리밍 안정성, 백프레셔 및 단일 LLM 스트림 보장)**:
  * **클라이언트 종료 감지 및 자원 회수**: 클라이언트가 브라우저 탭을 닫거나 연결을 종료(`req.on('close')`)하면 즉시 `AbortController`를 abort하여 LLM Provider의 추론과 소켓 버퍼 낭비를 원천 차단한다.
  * **출력 백프레셔(Backpressure) 처리**: 느린 네트워크 클라이언트에 대해 `res.write()`가 `false`를 반환하면 Node.js `drain` 이벤트를 대기(`once(res, 'drain', { signal })`)하여 프로세스 메모리 버퍼의 무한 팽창(OOM)을 방지한다.
  * **프록시 버퍼링 방지 및 Keep-Alive**: 리버스 프록시(Nginx 등)의 SSE 버퍼링을 방지하기 위해 `X-Accel-Buffering: no` 헤더를 설정하고, 60초 유휴 타임아웃 방지를 위해 15초 주기로 SSE 주석 핑(`: ping\n\n`) 하트비트를 유지한다.
  * **단일 LLM 호출 보장**: 스트리밍 대화 시 `generate()`를 선행 호출하여 답변을 통째로 받아오는 비효율 및 이중 과금을 제거하고, `provider.stream(messages, tools, signal)`을 통해 직접 실시간 토큰을 방출하며 청크 내 도구 호출을 감지한다.
  * **에러 마스킹**: 스트리밍 도중 예외가 발생하더라도 데이터베이스 정보나 스택트레이스 원문 메시지를 SSE로 노출하지 않으며, 표준화된 에러 코드(`code`)로 추상화하여 전송한다.
* **`BR-A09` (LLM 입력 경계 검증, 시스템 프롬프트 격리 및 도구 인자 상한 강제)**:
  * **대화 입력 경계**: 클라이언트로부터 수신하는 메시지의 `role`은 오직 `user`와 `assistant`로 제한되며, `system` role 전달 시 유효성 검사 실패(`400 Bad Request`)로 차단하여 간접 프롬프트 인젝션을 방어한다.
  * **메시지 및 본문 길이 상한**: 토큰 폭증 및 과도한 API 비용 청구를 방지하기 위해 단일 메시지 본문은 최대 8,000자, 메시지 배열 길이는 최대 50개로 엄격히 제한한다.
  * **Provider 시스템 프롬프트 분리 주입**: LLM Provider(Gemini 등) 호출 시 `role === 'system'` 메시지를 대화 본문(`contents`)의 `user` role로 치환하지 않고 최상위 `systemInstruction` 필드로 분리 전달하여 보안 지침의 우선순위와 격리를 보장한다.
  * **도구 인자 Zod 검증 및 상한 강제**: AI가 호출하는 도구의 인자(`query`, `limit`, `documentId`, `title`, `content` 등)는 사전에 정의된 Zod 스키마로 엄격히 검증하며, 특히 `search_my_documents`의 `limit`은 1~10으로 강제 제한하여 과도한 벡터 조회를 차단한다.
  * **문서 원문 절단 및 XML 속성 이스케이프**: `read_document` 도구 호출 시 문서 본문은 최대 10,000자로 절단(truncate)하여 컨텍스트 윈도우 폭증을 방지하고, 문서 제목 및 ID는 특수문자/태그 탈출 문자(`"`, `<`, `>`, `&`, `'`)를 XML Entity로 안전하게 이스케이프하여 컨텍스트 경계 태그 탈출을 원천 방지한다.
* **`BR-A10` (임베딩 모델 공간 격리 및 설정 기본값 단일 소스화)**:
  * **설정 기본값 단일 소스화(SSOT)**: Gemini 및 Ollama의 모델 기본값(`GEMINI_MODEL=gemini-3.8-flash`, `GEMINI_EMBEDDING_MODEL=text-embedding-004` 등)은 `libs/config` 한 곳에서만 일관되게 정의하며, 프로바이더와 환경변수 검증 스키마 간 불일치를 원천 차단한다.
  * **페이로드 모델 식별자 저장**: 문서 인덱싱(`INDEX`) 시 생성된 포인트 페이로드에 임베딩을 수행한 모델 식별자(`embeddingModel`)를 필수 저장하고, 키워드 인덱스를 생성하여 조회 성능을 보장한다.
  * **검색 벡터 공간 격리 필터**: 시맨틱 검색(`POST /api/v1/ai/search` 및 `search_my_documents`) 시 질의어를 임베딩한 모델(`embeddingModel`)을 Qdrant 검색 필터(`must`)에 강제 포함하여, 서로 다른 임베딩 모델(예: text-embedding-004 vs nomic-embed-text)의 벡터가 동일 컬렉션 내에 공존하더라도 상이한 벡터 공간이 혼재되어 검색 품질이 붕괴하는 현상을 원천 방지한다.
  * **컬렉션 차원 및 거리 함수 런타임 검증**: Qdrant 초기화(`ensureCollection`) 시 기존 컬렉션의 벡터 차원(`size=768`) 및 거리 함수(`distance=Cosine`)를 검증하여 불일치 시 명확한 에러 로그를 남기고 비정상 색인을 방지한다.

---

## 5. 인터페이스 및 API 규격

### 5.1 개인 문서 시맨틱 검색 (`POST /api/v1/ai/search`)
* **Request Body**:
  ```json
  {
    "query": "NestJS 아키텍처 설계",
    "limit": 5,
    "folderId": "uuid...",
    "tags": ["backend"]
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "results": [
      {
        "documentId": "uuid...",
        "title": "백엔드 아키텍처",
        "heading": "## 2. 모듈 구조",
        "content": "NestJS는 모듈 단위로 구성되며...",
        "score": 0.892,
        "tags": ["backend"]
      }
    ],
    "total": 1
  }
  ```

### 5.2 AI Chat 단발성 응답 (`POST /api/v1/ai/chat`)
* **Request Body**:
  ```json
  {
    "messages": [
      { "role": "user", "content": "내 문서 중에서 아키텍처 내용 요약해줘" }
    ],
    "provider": "gemini",
    "enableTools": true
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "message": {
      "role": "assistant",
      "content": "작성하신 문서에 따르면..."
    },
    "toolExecutions": [
      { "name": "search_my_documents", "args": { "query": "아키텍처" } }
    ]
  }
  ```

### 5.3 AI Chat 실시간 스트리밍 (`POST /api/v1/ai/chat/stream`)
* **Headers**: `Accept: text/event-stream`
* **Response (200 OK, SSE Stream)**:
  ```text
  event: token
  data: {"delta": "작성하신 "}

  event: token
  data: {"delta": "문서에 따르면..."}

  event: done
  data: {"finished": true}
  ```

---

## 6. 에러 코드 매핑

| HTTP Status | 에러 코드 (`code`) | 원인 및 설명 |
| :--- | :--- | :--- |
| `400 Bad Request` | `AI_INVALID_QUERY` | 검색 쿼리나 메시지가 비어있음 |
| `400 Bad Request` | `AI_PROVIDER_UNSUPPORTED` | 지원하지 않는 AI Provider 요청 |
| `404 Not Found` | `AI_DOCUMENT_NOT_FOUND` | 도구 실행 시 지정한 문서를 찾을 수 없음 |
| `502 Bad Gateway` | `AI_PROVIDER_ERROR` | Gemini 또는 Ollama API 호출 실패 |
| `503 Service Unavailable` | `QDRANT_UNAVAILABLE` | Qdrant 벡터 데이터베이스 연결 불가 |
