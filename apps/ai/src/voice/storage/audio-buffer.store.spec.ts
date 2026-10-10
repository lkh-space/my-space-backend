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
});
