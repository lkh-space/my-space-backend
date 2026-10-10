---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-09
---

# J.A.R.V.I.S. Neural Core 음성 비서 파이프라인 사양서 (Specification)

## 1. 개요 (Summary)

본 문서는 프론트엔드(`my-space-frontend`)의 **실시간 음성 상호작용 중심 SF 비서(J.A.R.V.I.S. Neural Core)** 전면 리디자인에 맞추어 백엔드 AI 서비스(`apps/ai`)의 음성 입력(STT), 실시간 추론 및 텔레메트리 스트리밍(SSE), 음성 합성(TTS), 그리고 즉시 발화 인터럽트(Interrupt) 파이프라인을 정의하는 기능 명세서입니다.

`BACKEND_VOICE_AI_INTERFACE.md`를 단일 진실 공급원(SSOT)으로 하며, 기존 단발성/텍스트 전용 챗봇 구조에서 **멀티모달 실시간 음성 비서 파이프라인**으로 확장합니다.

---

## 2. 목표 및 제외 대상 (Goals / Non-goals)

### 목표 (Goals)
* **신경망 스트림 세션 라이프사이클 관리**:
  - `LIVE`, `idle`, `saved` 상태를 갖는 신경망 스트림 세션 생성 및 목록 조회.
* **음성/텍스트 멀티모달 SSE 스트리밍 (`POST /api/v1/ai/voice/stream`)**:
  - PTT 음성 녹음 Blob(`multipart/form-data`) 및 텍스트 후속 질의(`application/json`) 동시 지원.
  - 전사 텍스트(`transcription`), 토큰(`token`), 벤치마크 지표(`benchmark`), Qdrant 참조 문서(`context_ref`), 완성 오디오(`audio_complete`), 스트림 종료(`done`), 오류(`error`) 8대 이벤트 전송.
* **초저지연 발화 중단 (Interrupt) 메커니즘 (`POST /api/v1/ai/chat/interrupt`)**:
  - 스페이스바 입력 시 세션별 `AbortController`를 트리거하여 진행 중인 LLM 추론 및 TTS 합성을 50ms 이내에 즉각 중단.
* **플러그형 음성 엔진 (STT/TTS) 추상화**:
  - Phase 1 모의/경량 엔진 지원 및 Phase 2 Piper TTS / Whisper STT 플러그형 Provider 연계.
* **합성 오디오 서빙 (`GET /api/v1/ai/audio/:id`)**:
  - 합성된 WAV/Opus 음성 버퍼를 스트리밍 또는 파일 형태로 브라우저 캡슐 플레이어에 서빙.
* **음성 엔진 헬스체크 확장 (`GET /health`)**:
  - 기존 서버 상태 외에 음성 파이프라인(WASM/Piper/Whisper) 런타임 진단 필드 제공.

### 제외 대상 (Non-goals)
* 양방향 Full-Duplex WebRTC 실시간 음성 통화 (Phase 1에서는 HTTP Multipart + SSE 방식으로 구현)
* 영구 오디오 파일 클라우드 무기한 보관 (합성된 오디오는 임시 캐시 및 TTL 만료 후 자동 정리)
* 다중 화자 음성 분리 (Diarization)

---

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-J01` | 사용자 | 신경망 세션 생성 및 조회 | 새로운 J.A.R.V.I.S. 신경망 스트림 세션을 생성하고, 활성/저장 세션 목록을 조회한다. |
| `UC-J02` | 사용자 | 텍스트 질의 기반 텔레메트리 스트리밍 | 텍스트 후속 질의를 전송하여 실시간 토큰, 벤치마크 지표 및 Qdrant 참조 문서를 SSE로 수신한다. |
| `UC-J03` | 사용자 | Push-To-Talk (PTT) 음성 질의 | 스페이스바로 녹음된 음성 Blob을 전송하고, STT 전사 텍스트와 답변 토큰 및 음성을 스트리밍으로 수신한다. |
| `UC-J04` | 사용자 | 합성 음성 다운로드 및 재생 | LLM 답변 합성 완료 후 전달된 `audioUrl`로 최종 오디오(.wav)를 브라우저에서 스트리밍 재생한다. |
| `UC-J05` | 사용자 | 발화 즉시 중단 (Speech Interrupt) | AI 답변 발화 또는 생성 중 스페이스바를 눌러 즉시 파이프라인을 캔슬하고 리소스를 반환한다. |
| `UC-J06` | 시스템 | 음성 엔진 헬스체크 및 런타임 진단 | 서버 및 음성 합성/인식 엔진(WASM/Piper/Whisper)의 가동 상태를 주기적으로 확인한다. |

---

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-J01` (세션 소유권 격리 및 상태 전이)**:
  - 모든 신경망 세션은 요청자의 `ownerId`에 강제 바인딩되며, 타인의 세션에 접근하거나 인터럽트할 수 없다.
  - 세션 상태는 활성 스트리밍 시 `LIVE`, 대기 시 `idle`, 사용자가 보관 요청 시 `saved`로 전이된다.
* **`BR-J02` (인터럽트 즉시성 및 리소스 정리)**:
  - 인터럽트 요청 수신 시 서버는 지체 없이 해당 세션의 `AbortController.abort()`를 호출해야 하며, 진행 중인 LLM API 스트림 소비와 TTS 프로세스를 즉시 종료하고 연결된 SSE에 `{ "interrupted": true }`를 발행하거나 정상 종료해야 한다.
* **`BR-J03` (텔레메트리 메트릭 무결성)**:
  - `benchmark` 이벤트는 `workerName`, `opfsStream`, `remoteSse` 필드를 반드시 포함하여 프론트엔드 메트릭 카드 렌더링을 보장해야 한다.
  - `context_ref` 이벤트는 Qdrant 검색된 문서 청크의 메타데이터(`id`, `title`, `filename`, `type`)를 프론트엔드 규격에 맞게 변환하여 전달해야 한다.
* **`BR-J04` (음성 오디오 수신 및 크기 제약)**:
  - PTT 오디오 파일은 `multipart/form-data`의 `audio` 필드로 전달되며, 지원 형식은 `audio/wav`, `audio/webm`, `audio/ogg`이다.
  - 1회 발화 오디오 최대 용량은 10MB로 제한되며 초과 시 `AI_AUDIO_PAYLOAD_TOO_LARGE` 예외를 반환한다.
* **`BR-J05` (폴백 및 에러 격리)**:
  - STT 실패 시 전체 스트림을 비정상 종료하지 않고 오류 이벤트를 전송하거나 텍스트 입력을 유도한다.
  - TTS 실패 시 텍스트 답변(`token`)은 정상 수신되도록 하며, `audio_complete` 생략 후 `done`으로 안전하게 스트림을 마무리한다.
* **`BR-J06` (오디오 버퍼 TTL 만료)**:
  - 합성된 오디오 파일은 메모리 또는 임시 디렉토리에 캐싱되며, 생성 후 1시간(기본 TTL)이 경과하면 자동 폐기된다.

---

## 5. 인터페이스 및 API 규격 (Interface / API)

### 5.1. 엔드포인트 목록

| Method | Endpoint | 설명 | Content-Type |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | 서버 및 음성 엔진(WASM/Piper/Whisper) 헬스체크 | `application/json` |
| `GET` | `/api/v1/ai/sessions` | 신경망 스트림 세션 목록 조회 (`LIVE`, `idle`, `saved`) | `application/json` |
| `POST` | `/api/v1/ai/sessions` | 신규 신경망 세션 생성 | `application/json` |
| `POST` | `/api/v1/ai/voice/stream` ⭐ | 음성 오디오(Blob) 또는 텍스트 질의 실시간 스트리밍 (SSE) | `multipart/form-data` 또는 `application/json` → `text/event-stream` |
| `POST` | `/api/v1/ai/chat/interrupt` | 진행 중인 LLM / TTS 파이프라인 즉시 취소 | `application/json` |
| `GET` | `/api/v1/ai/audio/:id` | 합성 완료된 최종 음성 파일 다운로드 (`.wav` / `.opus`) | `audio/wav` |

---

### 5.2. 핵심 TypeScript DTO 인터페이스

```typescript
export type AiEngineState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';
export type NeuralSessionStatus = 'LIVE' | 'idle' | 'saved';

/**
 * 1. 신경망 스트림 세션 DTO
 */
export interface NeuralStreamSessionDto {
  id: string;
  title: string;
  status: NeuralSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNeuralSessionDto {
  title?: string;
}

/**
 * 2. 음성 설정 파라미터 DTO
 */
export interface VoiceSettingsDto {
  selectedVoice: 'JARVIS British AI' | 'JARVIS Fast Neural' | 'JARVIS Deep Resonant';
  speechSpeed: number; // 1.0, 1.25, 1.5
  enableTelemetry?: boolean;
}

/**
 * 3. 음성/텍스트 질의 요청 Body (VoiceStreamQueryDto)
 */
export interface VoiceStreamQueryDto {
  sessionId: string;
  textQuery?: string;           // 텍스트 후속 질문 시 전달
  voiceSettings?: VoiceSettingsDto;
  enableTools?: boolean;        // Qdrant 문서 시맨틱 검색 연동 여부
}

/**
 * 4. 벤치마크 텔레메트리 메트릭
 */
export interface BenchmarkDeltaMetricsDto {
  workerName: string; // e.g. 'local-storage-worker'
  opfsStream: string; // e.g. '~1.8ms lat / 0 locks'
  remoteSse: string;  // e.g. '~8.4ms lat / 3 retries'
}

/**
 * 5. 참조 문서 컨텍스트 (Qdrant 시맨틱 검색 결과 매핑)
 */
export interface ReferencedContextDto {
  id: string;
  title: string;
  filename: string;
  type: 'doc' | 'architecture' | 'code';
}

/**
 * 6. 발화 인터럽트(중단) 요청 Body
 */
export interface InterruptQueryDto {
  sessionId: string;
  streamId?: string;
}
```

---

### 5.3. 실시간 SSE 이벤트 규격 (`POST /api/v1/ai/voice/stream`)

| 이벤트명 (`event`) | 페이로드 데이터 (`data`) 예시 | 설명 |
| :--- | :--- | :--- |
| **`transcription`** | `{"text": "OPFS 캐싱 구조와 벤치마크 비교해줘"}` | STT 변환 완료 시 사용자 발화 텍스트 반환 (음성 질의 시) |
| **`token`** | `{"delta": "Welcome back, sir."}` | 실시간 생성되는 LLM 답변 텍스트 조각 |
| **`audio_chunk`** | `{"chunkIndex": 1, "audioBase64": "..."}` | 실시간 스트리밍 TTS 오디오 조각 (선택적) |
| **`benchmark`** | `{"workerName": "local-storage-worker", "opfsStream": "~1.8ms lat / 0 locks", "remoteSse": "~8.4ms lat / 3 retries"}` | 실시간 기술 벤치마크 지표 카드 렌더링용 |
| **`context_ref`** | `{"contexts": [{"id": "1", "title": "mongodb-streaming.md", "filename": "mongodb-streaming.md", "type": "doc"}]}` | 답변 도출에 참조된 마크다운 문서 링크 칩 |
| **`audio_complete`** | `{"audioUrl": "/api/v1/ai/audio/speech-123.wav", "duration": "0:38"}` | 최종 음성 합성 완료 및 재생 URL, 재생 시간 정보 |
| **`done`** | `{"finished": true, "tokensUsed": 2410, "contextLimit": 8192}` | 스트림 완전 종료 |
| **`error`** | `{"error": "STT 엔진 처리 오류"}` | 파이프라인 에러 |

---

## 6. 예외 처리 및 에러 스펙 (Error Handling)

> [!IMPORTANT]
> 본 사양서에 정의된 도메인 에러 코드는 전송 계층 매핑 테이블인 [`libs/common/src/filters/domain-error-http.map.ts`](../../libs/common/src/filters/domain-error-http.map.ts)의 `DOMAIN_ERROR_HTTP_MAP`에 등록되어야 합니다.

| 에러 상황 | 발생 예외 클래스 | 에러 코드 (`code`) | HTTP Status | DOMAIN_ERROR_HTTP_MAP 등록 필요 여부 |
| :--- | :--- | :--- | :--- | :--- |
| 세션을 찾을 수 없음 | `SessionNotFoundException` | `AI_SESSION_NOT_FOUND` | 404 Not Found | **필수 등록** |
| 세션이 비활성 상태임 | `SessionInactiveException` | `AI_SESSION_INACTIVE` | 422 Unprocessable Entity | 기본값 (422) |
| 요청 음성 파일 미존재 | `AudioFileNotFoundException` | `AI_AUDIO_NOT_FOUND` | 404 Not Found | **필수 등록** |
| 오디오 파일 용량 초과 | `AudioPayloadTooLargeException` | `AI_AUDIO_PAYLOAD_TOO_LARGE` | 413 Payload Too Large | **필수 등록** |
| 지원하지 않는 오디오 포맷 | `InvalidAudioFormatException` | `AI_AUDIO_INVALID_FORMAT` | 400 Bad Request | **필수 등록** |
| STT 음성 변환 실패 | `SttProcessingException` | `AI_STT_FAILED` | 502 Bad Gateway | **필수 등록** |
| TTS 음성 합성 실패 | `TtsSynthesisException` | `AI_TTS_FAILED` | 502 Bad Gateway | **필수 등록** |
| 인터럽트 대상 스트림 없음 | `StreamNotFoundException` | `AI_STREAM_NOT_FOUND` | 404 Not Found | **필수 등록** |

---

## 7. 오픈 질문 (Open Questions)

* [ ] **세션 저장소 영속화 전략**:
  - 현재는 인메모리 세션 스토어로 충분하나, 향후 세션 히스토리 영구 저장이 필요할 경우 Prisma 스키마(`neural_sessions`) 마이그레이션 적용 시점을 결정해야 합니다.
* [ ] **운영 환경 TTS/STT 패키징**:
  - Docker 컨테이너 내 Piper 바이너리 번들링 방식과 로컬 Node.js WASM 기반 엔진 방식 중 프로덕션 배포 파이프라인(k8s)에서의 최적 리소스 패키징 방식을 확정해야 합니다.
