import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NeuralSessionController } from './neural-session.controller.js';
import type { NeuralSessionService } from './neural-session.service.js';
import type { AuthUser } from '@app/common/guards/remote-user.guard.js';

describe('NeuralSessionController (BDD 단위 테스트)', () => {
  let controller: NeuralSessionController;
  let mockService: NeuralSessionService;
  const mockUser: AuthUser = {
    username: 'dev-admin',
    email: 'admin@local.test',
    name: 'Dev Admin',
    groups: ['admin'],
  };

  beforeEach(() => {
    mockService = {
      listSessions: vi.fn(),
      createSession: vi.fn(),
    } as unknown as NeuralSessionService;

    controller = new NeuralSessionController(mockService);
  });

  it('listSessions 호출 시 현재 사용자의 세션 목록을 반환해야 한다', async () => {
    // given
    const mockSessions = [
      {
        id: 'session-1',
        title: 'Session 1',
        status: 'idle' as const,
        createdAt: '2026-10-09T00:00:00.000Z',
        updatedAt: '2026-10-09T00:00:00.000Z',
      },
    ];
    vi.spyOn(mockService, 'listSessions').mockResolvedValue(mockSessions);

    // when
    const result = await controller.listSessions(mockUser);

    // then
    expect(mockService.listSessions).toHaveBeenCalledWith('dev-admin');
    expect(result).toEqual(mockSessions);
  });

  it('createSession 호출 시 신규 생성된 세션 DTO를 반환해야 한다', async () => {
    // given
    const dto = { title: 'New Stream' };
    const createdSession = {
      id: 'session-new',
      title: 'New Stream',
      status: 'idle' as const,
      createdAt: '2026-10-09T00:00:00.000Z',
      updatedAt: '2026-10-09T00:00:00.000Z',
    };
    vi.spyOn(mockService, 'createSession').mockResolvedValue(createdSession);

    // when
    const result = await controller.createSession(mockUser, dto);

    // then
    expect(mockService.createSession).toHaveBeenCalledWith('dev-admin', dto);
    expect(result).toEqual(createdSession);
  });
});
