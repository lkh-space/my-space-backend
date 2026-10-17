import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type { AuthUser } from '@app/common/guards/remote-user.guard.js';
import { BaseDomainException } from '@app/common/exceptions/domain.exception.js';
import { AiChatController } from './ai-chat.controller.js';
import type { AiChatService } from './ai-chat.service.js';

class MockDomainException extends BaseDomainException {
  readonly code = 'AI_DOMAIN_ERROR';

  constructor() {
    super('도메인 비즈니스 규칙 위반');
  }
}

describe('AiChatController (BDD 단위 테스트)', () => {
  let controller: AiChatController;
  let mockChatService: AiChatService;
  const mockUser: AuthUser = {
    username: 'dev-admin',
    email: 'admin@local.test',
    name: 'Dev Admin',
    groups: ['admin'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockChatService = {
      chat: vi.fn(),
      streamChat: vi.fn(),
    } as unknown as AiChatService;

    controller = new AiChatController(mockChatService);
  });

  describe('단발성 대화 (chat)', () => {
    it('요청 DTO를 전달하여 단발성 답변을 반환해야 한다', async () => {
      // given
      const dto = {
        messages: [{ role: 'user' as const, content: '안녕' }],
      };
      const expectedResponse = {
        message: { role: 'assistant' as const, content: '안녕하세요!' },
      };
      vi.spyOn(mockChatService, 'chat').mockResolvedValue(expectedResponse);

      // when
      const result = await controller.chat(mockUser, dto);

      // then
      expect(mockChatService.chat).toHaveBeenCalledWith('dev-admin', dto);
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('실시간 SSE 스트리밍 대화 (streamChat)', () => {
    it('SSE 헤더(X-Accel-Buffering 포함)를 설정하고 청크를 순차적으로 write한 뒤 스트림을 종료해야 한다', async () => {
      // given
      async function* mockChunks() {
        yield { event: 'token', data: '{"delta":"안녕"}' };
        yield { event: 'done', data: '{"finished":true}' };
      }
      vi.spyOn(mockChatService, 'streamChat').mockImplementation(
        mockChunks as any,
      );

      const writtenData: string[] = [];
      const mockReq = {
        on: vi.fn(),
      } as unknown as Request;

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => {
          writtenData.push(chunk);
          return true;
        }),
        end: vi.fn(),
        writableEnded: false,
      } as unknown as Response;

      const dto = {
        messages: [{ role: 'user' as const, content: '안녕' }],
      };

      // when
      await controller.streamChat(mockUser, dto, mockReq, mockRes);

      // then
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream; charset=utf-8',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache, no-transform',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Connection',
        'keep-alive',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'X-Accel-Buffering',
        'no',
      );
      expect(mockReq.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(writtenData).toEqual([
        'event: token\ndata: {"delta":"안녕"}\n\n',
        'event: done\ndata: {"finished":true}\n\n',
      ]);
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('클라이언트 연결 종료(req.close) 감지 시 AbortController를 abort해야 한다', async () => {
      // given
      let closeHandler: (() => void) | undefined;
      const mockReq = {
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'close') {
            closeHandler = handler;
          }
        }),
      } as unknown as Request;

      let receivedSignal: AbortSignal | undefined;
      async function* mockChunks(
        _owner: string,
        _dto: unknown,
        signal?: AbortSignal,
      ) {
        receivedSignal = signal;
        // 클라이언트 종료 시뮬레이션
        if (closeHandler) {
          closeHandler();
        }
        if (signal?.aborted) return;
        yield { event: 'token', data: '{"delta":"1"}' };
      }
      vi.spyOn(mockChatService, 'streamChat').mockImplementation(
        mockChunks as any,
      );

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        flushHeaders: vi.fn(),
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        writableEnded: false,
      } as unknown as Response;

      const dto = {
        messages: [{ role: 'user' as const, content: '안녕' }],
      };

      // when
      await controller.streamChat(mockUser, dto, mockReq, mockRes);

      // then
      expect(receivedSignal?.aborted).toBe(true);
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('스트리밍 도중 도메인 예외 발생 시 에러 코드(Domain code)로 마스킹하여 반환해야 한다', async () => {
      // given
      async function* mockFailingStream() {
        yield { event: 'token', data: '{"delta":"시작"}' };
        throw new MockDomainException();
      }
      vi.spyOn(mockChatService, 'streamChat').mockImplementation(
        mockFailingStream as any,
      );

      const writtenData: string[] = [];
      const mockReq = {
        on: vi.fn(),
      } as unknown as Request;

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => {
          writtenData.push(chunk);
          return true;
        }),
        end: vi.fn(),
        writableEnded: false,
      } as unknown as Response;

      const dto = {
        messages: [{ role: 'user' as const, content: '질문' }],
      };

      // when
      await controller.streamChat(mockUser, dto, mockReq, mockRes);

      // then
      expect(writtenData).toContain('event: token\ndata: {"delta":"시작"}\n\n');
      expect(writtenData).toContain(
        `event: error\ndata: ${JSON.stringify({ code: 'AI_DOMAIN_ERROR' })}\n\n`,
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('스트리밍 도중 일반 Error 발생 시 내부 상세 스택 노출 없이 AI_STREAM_ERROR로 마스킹해야 한다', async () => {
      // given
      async function* mockFailingStream() {
        yield { event: 'token', data: '{"delta":"시작"}' };
        throw new Error('Database password leak: secret123!');
      }
      vi.spyOn(mockChatService, 'streamChat').mockImplementation(
        mockFailingStream as any,
      );

      const writtenData: string[] = [];
      const mockReq = {
        on: vi.fn(),
      } as unknown as Request;

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => {
          writtenData.push(chunk);
          return true;
        }),
        end: vi.fn(),
        writableEnded: false,
      } as unknown as Response;

      const dto = {
        messages: [{ role: 'user' as const, content: '질문' }],
      };

      // when
      await controller.streamChat(mockUser, dto, mockReq, mockRes);

      // then
      expect(writtenData).not.toContain('secret123');
      expect(writtenData).toContain(
        `event: error\ndata: ${JSON.stringify({ code: 'AI_STREAM_ERROR' })}\n\n`,
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('res.write가 false를 반환하면 drain 이벤트를 대기하는 백프레셔를 처리해야 한다', async () => {
      // given
      async function* mockChunks() {
        yield { event: 'token', data: '{"delta":"1"}' };
        yield { event: 'token', data: '{"delta":"2"}' };
      }
      vi.spyOn(mockChatService, 'streamChat').mockImplementation(
        mockChunks as any,
      );

      const mockReq = {
        on: vi.fn(),
      } as unknown as Request;

      let writeCount = 0;
      let drainEmitted = false;

      const mockRes = Object.assign(new EventEmitter(), {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        flushHeaders: vi.fn(),
        write: vi.fn(() => {
          writeCount++;
          if (writeCount === 1) {
            // 첫 write 시 버퍼 꽉참(false) 반환하고 잠시 후 drain 방출
            setTimeout(() => {
              drainEmitted = true;
              mockRes.emit('drain');
            }, 10);
            return false;
          }
          return true;
        }),
        end: vi.fn(),
        writableEnded: false,
      }) as unknown as Response;

      const dto = {
        messages: [{ role: 'user' as const, content: '테스트' }],
      };

      // when
      await controller.streamChat(mockUser, dto, mockReq, mockRes);

      // then
      expect(drainEmitted).toBe(true);
      expect(writeCount).toBe(2);
      expect(mockRes.end).toHaveBeenCalled();
    });
  });
});
