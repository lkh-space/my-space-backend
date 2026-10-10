import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JarvisVoiceService } from './jarvis-voice.service.js';
import { NeuralSessionService } from '../sessions/neural-session.service.js';
import { ActiveStreamRegistry } from './active-stream.registry.js';
import { AudioBufferStore } from './storage/audio-buffer.store.js';
import { MockSttProvider, MockTtsProvider } from '../providers/voice/mock-voice.provider.js';
import type { ProviderFactory } from '../providers/provider.factory.js';
import type { AiSearchService } from '../search/ai-search.service.js';
import type { LlmProvider } from '../providers/llm.provider.interface.js';
import { SessionNotFoundException } from './exceptions/voice.exception.js';

describe('JarvisVoiceService (BDD 단위 테스트)', () => {
  let service: JarvisVoiceService;
  let sessionService: NeuralSessionService;
  let streamRegistry: ActiveStreamRegistry;
  let audioStore: AudioBufferStore;
  let sttProvider: MockSttProvider;
  let ttsProvider: MockTtsProvider;
  let mockProviderFactory: ProviderFactory;
  let mockAiSearchService: AiSearchService;
  let mockLlmProvider: LlmProvider;

  beforeEach(() => {
    sessionService = new NeuralSessionService();
    streamRegistry = new ActiveStreamRegistry();
    audioStore = new AudioBufferStore();
    sttProvider = new MockSttProvider();
    ttsProvider = new MockTtsProvider();

    mockLlmProvider = {
      name: 'gemini',
      generate: vi.fn(),
      stream: vi.fn(),
    };

    mockProviderFactory = {
      getLlmProvider: vi.fn().mockReturnValue(mockLlmProvider),
      getEmbeddingProvider: vi.fn(),
    } as unknown as ProviderFactory;

    mockAiSearchService = {
      search: vi.fn().mockResolvedValue({
        results: [
          {
            documentId: 'doc-1',
            title: 'architecture-notes.md',
            content: 'OPFS 캐싱 및 벤치마크 설계 내용',
          },
        ],
        total: 1,
      }),
    } as unknown as AiSearchService;

    service = new JarvisVoiceService(
      sessionService,
      streamRegistry,
      audioStore,
      sttProvider,
      ttsProvider,
      mockProviderFactory,
      mockAiSearchService,
    );
  });

  describe('텍스트 질의 실시간 스트리밍 (streamVoiceQuery)', () => {
    it('텍스트 질의 시 benchmark, context_ref, token, audio_complete, done 이벤트가 순서대로 방출되어야 한다', async () => {
      // given
      const ownerId = 'user-jarvis';
      const session = await sessionService.createSession(ownerId, {
        title: 'Diagnostic Stream',
      });

      async function* mockLlmStream() {
        yield 'Welcome back, ';
        yield 'sir. All systems online.';
      }
      vi.spyOn(mockLlmProvider, 'stream').mockImplementation(mockLlmStream as any);

      const dto = {
        sessionId: session.id,
        textQuery: '시스템 상태 보고해줘',
        enableTools: true,
        voiceSettings: {
          selectedVoice: 'JARVIS British AI' as const,
          speechSpeed: 1.0,
          enableTelemetry: true,
        },
      };

      // when
      const events: Array<{ event: string; data: string }> = [];
      for await (const chunk of service.streamVoiceQuery({
        ownerId,
        dto,
      })) {
        events.push(chunk);
      }

      // then
      const eventNames = events.map((e) => e.event);
      expect(eventNames).toEqual([
        'benchmark',
        'context_ref',
        'token',
        'token',
        'audio_complete',
        'done',
      ]);

      const benchmarkData = JSON.parse(events[0].data);
      expect(benchmarkData.workerName).toBe('local-storage-worker');

      const contextData = JSON.parse(events[1].data);
      expect(contextData.contexts.length).toBe(1);
      expect(contextData.contexts[0].title).toBe('architecture-notes.md');

      const audioCompleteData = JSON.parse(events[4].data);
      expect(audioCompleteData.audioUrl).toMatch(/^\/api\/v1\/ai\/audio\/speech-/);
      expect(audioCompleteData.duration).toBeDefined();

      const doneData = JSON.parse(events[5].data);
      expect(doneData.finished).toBe(true);

      // 세션 상태가 스트림 완료 후 idle로 복원되었는지 확인
      const sessionEntity = await sessionService.getSession(ownerId, session.id);
      expect(sessionEntity.status).toBe('idle');
    });

    it('존재하지 않는 세션 ID로 요청하면 SessionNotFoundException이 발생해야 한다', async () => {
      // given
      const ownerId = 'user-jarvis';
      const dto = {
        sessionId: 'non-existent-session',
        textQuery: '테스트',
      };

      // when & then
      await expect(
        (async () => {
          for await (const _ of service.streamVoiceQuery({ ownerId, dto })) {
            // no-op
          }
        })(),
      ).rejects.toThrow(SessionNotFoundException);
    });
  });

  describe('음성 오디오 파일 수신 스트리밍 (PTT Audio Blob)', () => {
    it('오디오 파일이 함께 전달되면 transcription 이벤트가 최우선으로 방출되어야 한다', async () => {
      // given
      const ownerId = 'user-jarvis';
      const session = await sessionService.createSession(ownerId, {
        title: 'Voice Session',
      });

      async function* mockLlmStream() {
        yield '음성을 확인했습니다.';
      }
      vi.spyOn(mockLlmProvider, 'stream').mockImplementation(mockLlmStream as any);

      const fakeAudioBuffer = Buffer.from('fake-wav-data');
      const dto = {
        sessionId: session.id,
        enableTools: false,
      };

      // when
      const events: Array<{ event: string; data: string }> = [];
      for await (const chunk of service.streamVoiceQuery({
        ownerId,
        dto,
        audioFile: {
          buffer: fakeAudioBuffer,
          mimetype: 'audio/wav',
          size: fakeAudioBuffer.length,
        },
      })) {
        events.push(chunk);
      }

      // then
      expect(events[0].event).toBe('transcription');
      const transcriptionData = JSON.parse(events[0].data);
      expect(transcriptionData.text).toBe(
        'Compare local OPFS caching with MongoDB change streams',
      );
    });
  });

  describe('발화 즉시 중단 (Speech Interrupt)', () => {
    it('인터럽트가 발생하면 스트림이 중단되고 interrupted 플래그가 포함된 done 이벤트로 조기 종료되어야 한다', async () => {
      // given
      const ownerId = 'user-jarvis';
      const session = await sessionService.createSession(ownerId, {
        title: 'Interrupt Test Session',
      });

      async function* mockLongStream() {
        yield '첫 번째 문장입니다. ';
        // 스트리밍 도중 인터럽트 발생
        service.interrupt(session.id);
        yield '이 문장은 전달되지 않거나 중단되어야 합니다.';
      }
      vi.spyOn(mockLlmProvider, 'stream').mockImplementation(mockLongStream as any);

      const dto = {
        sessionId: session.id,
        textQuery: '긴 답변을 해줘',
        enableTools: false,
      };

      // when
      const events: Array<{ event: string; data: string }> = [];
      for await (const chunk of service.streamVoiceQuery({
        ownerId,
        dto,
      })) {
        events.push(chunk);
      }

      // then
      const lastEvent = events[events.length - 1];
      expect(lastEvent.event).toBe('done');
      const doneData = JSON.parse(lastEvent.data);
      expect(doneData.finished).toBe(true);
      expect(doneData.interrupted).toBe(true);
    });
  });

  describe('오디오 버퍼 조회 (getAudioBuffer)', () => {
    it('저장된 오디오 ID로 버퍼를 정상 반환해야 한다', () => {
      // given
      const buffer = Buffer.from('saved-wav-data');
      const audioId = audioStore.saveAudio(buffer, 'wav', 'audio/wav');

      // when
      const result = service.getAudioBuffer(`${audioId}.wav`);

      // then
      expect(result).not.toBeNull();
      expect(result?.buffer).toEqual(buffer);
    });
  });
});
