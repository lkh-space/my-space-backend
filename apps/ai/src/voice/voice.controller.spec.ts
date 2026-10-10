import type { AuthUser } from '@app/common/guards/remote-user.guard.js';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioFileNotFoundException } from './exceptions/voice.exception.js';
import type { JarvisVoiceService } from './jarvis-voice.service.js';
import { VoiceController } from './voice.controller.js';

describe('VoiceController (BDD 단위 테스트)', () => {
  let controller: VoiceController;
  let mockVoiceService: JarvisVoiceService;
  const mockUser: AuthUser = {
    username: 'dev-admin',
    email: 'admin@local.test',
    name: 'Dev Admin',
    groups: ['admin'],
  };

  beforeEach(() => {
    mockVoiceService = {
      streamVoiceQuery: vi.fn(),
      interrupt: vi.fn(),
      getAudioBuffer: vi.fn(),
    } as unknown as JarvisVoiceService;

    controller = new VoiceController(mockVoiceService);
  });

  describe('실시간 SSE 음성 스트리밍 (streamVoice)', () => {
    it('SSE 헤더를 설정하고 이벤트 청크를 write해야 한다', async () => {
      // given
      async function* mockChunks() {
        yield { event: 'token', data: '{"delta":"hello"}' };
        yield { event: 'done', data: '{"finished":true}' };
      }
      vi.spyOn(mockVoiceService, 'streamVoiceQuery').mockImplementation(
        mockChunks as any,
      );

      const writtenData: string[] = [];
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => {
          writtenData.push(chunk);
          return true;
        }),
        end: vi.fn(),
      } as unknown as Response;

      const rawBody = {
        sessionId: 'session-123',
        textQuery: '테스트 질의',
      };

      // when
      await controller.streamVoice(mockUser, rawBody, undefined, mockRes);

      // then
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream; charset=utf-8',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache, no-transform',
      );
      expect(writtenData).toEqual([
        'event: token\ndata: {"delta":"hello"}\n\n',
        'event: done\ndata: {"finished":true}\n\n',
      ]);
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('스트림 시작 전 도메인 예외 발생 시 즉시 해당 상태 코드의 JSON 실패 응답을 반환해야 한다', async () => {
      // given
      vi.spyOn(mockVoiceService, 'streamVoiceQuery').mockImplementation(() => {
        throw new AudioFileNotFoundException('audio-not-found');
      });

      const jsonMock = vi.fn();
      const mockRes = {
        status: vi.fn().mockReturnValue({ json: jsonMock }),
        json: jsonMock,
      } as unknown as Response;

      const rawBody = { sessionId: 'invalid-session' };

      // when
      await controller.streamVoice(mockUser, rawBody, undefined, mockRes);

      // then
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: expect.stringContaining('audio-not-found'),
        }),
      );
    });
  });

  describe('발화 즉시 중단 (interrupt)', () => {
    it('세션 ID로 interrupt 호출 시 중단 성공 결과를 반환해야 한다', async () => {
      // given
      vi.spyOn(mockVoiceService, 'interrupt').mockReturnValue({
        interrupted: true,
      });
      const dto = { sessionId: 'session-123' };

      // when
      const result = await controller.interrupt(mockUser, dto);

      // then
      expect(mockVoiceService.interrupt).toHaveBeenCalledWith('session-123');
      expect(result).toEqual({ status: 'ok', interrupted: true });
    });
  });

  describe('오디오 다운로드 (getAudio)', () => {
    it('존재하는 오디오 ID 요청 시 버퍼와 Content-Type을 전송해야 한다', async () => {
      // given
      const sampleBuffer = Buffer.from('riff-audio');
      vi.spyOn(mockVoiceService, 'getAudioBuffer').mockReturnValue({
        id: 'speech-1',
        buffer: sampleBuffer,
        format: 'wav',
        mimeType: 'audio/wav',
        createdAt: new Date(),
        expiresAt: new Date(),
      });

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as Response;

      // when
      await controller.getAudio('speech-1.wav', mockRes);

      // then
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'audio/wav',
      );
      expect(mockRes.send).toHaveBeenCalledWith(sampleBuffer);
    });

    it('존재하지 않는 오디오 ID 요청 시 AudioFileNotFoundException이 발생해야 한다', async () => {
      // given
      vi.spyOn(mockVoiceService, 'getAudioBuffer').mockReturnValue(null);
      const mockRes = {} as unknown as Response;

      // when & then
      await expect(
        controller.getAudio('non-existent.wav', mockRes),
      ).rejects.toThrow(AudioFileNotFoundException);
    });
  });
});
