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
* **`BR-A02` (최신 문서 기준 색인)**:
  * 문서 수정 시 기존 `documentId`의 청크 벡터는 모두 삭제되고 현재 버전의 청크만 재색인된다.
* **`BR-A03` (청크 무결성 보존)**:
  * 코드 블록(```)이나 테이블은 청크 중간에 잘리지 않아야 하며, 각 청크에는 소속 상위 헤딩 정보가 메타데이터로 첨부되어야 한다.
* **`BR-A04` (Prompt Injection 방어)**:
  * 검색된 문서 청크는 시스템 프롬프트 내에 격리 태그(`<untrusted_document_context>`)로 묶이며, 시스템 지시어로 해석되지 않도록 처리된다.
* **`BR-A05` (Tool 권한 제한)**:
  * AI가 실행하는 모든 도구는 요청자의 `ownerId` 권한 범위 내에서만 동작하며, 임의의 API를 호출할 수 없다.

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
