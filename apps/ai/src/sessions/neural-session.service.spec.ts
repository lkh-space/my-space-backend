import { describe, it, expect, beforeEach } from 'vitest';
import { NeuralSessionService } from './neural-session.service.js';
import { SessionNotFoundException } from '../voice/exceptions/voice.exception.js';

describe('NeuralSessionService', () => {
  let service: NeuralSessionService;

  beforeEach(() => {
    service = new NeuralSessionService();
  });

  it('새로운 세션을 생성하면 idle 상태의 DTO를 반환해야 한다', async () => {
    // given
    const ownerId = 'user-jarvis';
    const dto = { title: 'Diagnostic Session' };

    // when
    const session = await service.createSession(ownerId, dto);

    // then
    expect(session.id).toMatch(/^session-/);
    expect(session.title).toBe('Diagnostic Session');
    expect(session.status).toBe('idle');
    expect(session.createdAt).toBeDefined();
  });

  it('소유자별로 세션 목록을 최신순으로 조회할 수 있어야 한다', async () => {
    // given
    const ownerId = 'user-jarvis';
    await service.createSession(ownerId, { title: 'Session 1' });
    await service.createSession(ownerId, { title: 'Session 2' });
    await service.createSession('other-user', { title: 'Other Session' });

    // when
    const list = await service.listSessions(ownerId);

    // then
    expect(list.length).toBe(2);
    expect(list[0].title).toBe('Session 2');
    expect(list[1].title).toBe('Session 1');
  });

  it('타인의 세션에 접근하거나 존재하지 않는 세션 조회 시 SessionNotFoundException이 발생해야 한다', async () => {
    // given
    const ownerId = 'user-jarvis';
    const session = await service.createSession(ownerId, { title: 'Secret Session' });

    // when & then
    await expect(service.getSession('intruder', session.id)).rejects.toThrow(
      SessionNotFoundException,
    );
    await expect(service.getSession(ownerId, 'non-existent')).rejects.toThrow(
      SessionNotFoundException,
    );
  });

  it('세션 상태를 LIVE, saved 등으로 정상 갱신할 수 있어야 한다', async () => {
    // given
    const ownerId = 'user-jarvis';
    const session = await service.createSession(ownerId, { title: 'Test Session' });

    // when
    await service.updateSessionStatus(session.id, 'LIVE');
    const entity = await service.getSession(ownerId, session.id);

    // then
    expect(entity.status).toBe('LIVE');
  });
});
