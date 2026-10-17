import { describe, it, expect, beforeEach } from 'vitest';
import { AudioBufferStore } from './audio-buffer.store.js';

describe('AudioBufferStore', () => {
  let store: AudioBufferStore;

  beforeEach(() => {
    store = new AudioBufferStore();
  });

  it('오디오 버퍼를 저장하면 고유한 ID를 반환하고 정상 조회되어야 한다', () => {
    // given
    const sampleBuffer = Buffer.from('RIFF-sample-audio-data');

    // when
    const id = store.saveAudio(sampleBuffer, 'wav', 'audio/wav', 3600);
    const entry = store.getAudio(id);

    // then
    expect(id).toMatch(/^speech-/);
    expect(entry).not.toBeNull();
    expect(entry?.buffer).toEqual(sampleBuffer);
    expect(entry?.format).toBe('wav');
    expect(entry?.mimeType).toBe('audio/wav');
    expect(store.getAudioCount()).toBe(1);
  });

  it('존재하지 않는 오디오 ID 조회 시 null을 반환해야 한다', () => {
    // given
    const nonExistentId = 'speech-non-existent';

    // when
    const entry = store.getAudio(nonExistentId);

    // then
    expect(entry).toBeNull();
  });

  it('만료된 오디오 버퍼 조회 시 null을 반환하고 스토어에서 제거되어야 한다', () => {
    // given
    const sampleBuffer = Buffer.from('expired-sample');
    // TTL을 -1초로 주어 즉시 만료 상태로 저장
    const id = store.saveAudio(sampleBuffer, 'wav', 'audio/wav', -1);

    // when
    const entry = store.getAudio(id);

    // then
    expect(entry).toBeNull();
    expect(store.getAudioCount()).toBe(0);
  });

  it('소유권이 지정된 오디오는 다른 소유자(ownerId)가 조회 시 null을 반환하고 본인 소유 시 정상 반환해야 한다 (소유권 격리)', () => {
    // given
    const sampleBuffer = Buffer.from('owner-specific-audio');
    const id = store.saveAudio('user-alice', sampleBuffer, 'wav', 'audio/wav', 3600);

    // when: 타인(user-bob)이 조회 시도
    const bobEntry = store.getAudio(id, 'user-bob');
    // then
    expect(bobEntry).toBeNull();

    // when: 본인(user-alice)이 조회
    const aliceEntry = store.getAudio(id, 'user-alice');
    // then
    expect(aliceEntry).not.toBeNull();
    expect(aliceEntry?.buffer).toEqual(sampleBuffer);
  });

  it('용량 상한을 초과하여 저장 시 가장 오래된 항목부터 폐기해야 한다 (LRU Eviction)', () => {
    // given: 총 용량 상한을 30바이트로 인스턴스 설정
    (store as any).maxTotalBytes = 30;

    const buf1 = Buffer.from('1234567890'); // 10바이트
    const buf2 = Buffer.from('1234567890'); // 10바이트
    const buf3 = Buffer.from('1234567890'); // 10바이트
    const buf4 = Buffer.from('1234567890'); // 10바이트 (누적 40바이트로 초과 유발)

    const id1 = store.saveAudio('user-1', buf1);
    const id2 = store.saveAudio('user-1', buf2);
    const id3 = store.saveAudio('user-1', buf3);

    expect(store.getCurrentTotalBytes()).toBe(30);

    // when: 4번째 버퍼 추가 -> 가장 오래된 id1이 LRU 폐기되어야 함
    const id4 = store.saveAudio('user-1', buf4);

    // then
    expect(store.getCurrentTotalBytes()).toBe(30);
    expect(store.getAudio(id1)).toBeNull(); // 폐기됨
    expect(store.getAudio(id2)).not.toBeNull(); // 유지됨
    expect(store.getAudio(id3)).not.toBeNull(); // 유지됨
    expect(store.getAudio(id4)).not.toBeNull(); // 최신 항목 유지됨
  });
});
