import { describe, it, expect, beforeEach } from 'vitest';
import { ActiveStreamRegistry } from './active-stream.registry.js';

describe('ActiveStreamRegistry', () => {
  let registry: ActiveStreamRegistry;

  beforeEach(() => {
    registry = new ActiveStreamRegistry();
  });

  it('새로운 활성 스트림을 등록하면 AbortController를 반환하고 카운트가 증가해야 한다', () => {
    // given
    const sessionId = 'session-123';

    // when
    const controller = registry.registerStream(sessionId);

    // then
    expect(controller).toBeDefined();
    expect(controller.signal.aborted).toBe(false);
    expect(registry.getActiveStreamCount()).toBe(1);
  });

  it('동일 세션에 새로운 스트림을 등록하면 이전 스트림을 자동으로 중단시켜야 한다', () => {
    // given
    const sessionId = 'session-123';
    const firstController = registry.registerStream(sessionId);

    // when
    const secondController = registry.registerStream(sessionId);

    // then
    expect(firstController.signal.aborted).toBe(true);
    expect(secondController.signal.aborted).toBe(false);
    expect(registry.getActiveStreamCount()).toBe(1);
  });

  it('interruptStream 호출 시 해당 세션의 AbortController가 abort되고 스트림이 제거되어야 한다', () => {
    // given
    const sessionId = 'session-123';
    const controller = registry.registerStream(sessionId);

    // when
    const result = registry.interruptStream(sessionId);

    // then
    expect(result).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(registry.getActiveStreamCount()).toBe(0);
  });

  it('존재하지 않는 세션을 interruptStream 하면 false를 반환해야 한다', () => {
    // given
    const nonExistentSessionId = 'session-999';

    // when
    const result = registry.interruptStream(nonExistentSessionId);

    // then
    expect(result).toBe(false);
  });

  it('unregisterStream 호출 시 스트림이 정상 해제되어야 한다', () => {
    // given
    const sessionId = 'session-123';
    registry.registerStream(sessionId);

    // when
    registry.unregisterStream(sessionId);

    // then
    expect(registry.getActiveStreamCount()).toBe(0);
  });
});
