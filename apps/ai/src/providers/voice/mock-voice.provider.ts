import { Injectable, Logger } from '@nestjs/common';
import type {
  SttProvider,
  TtsProvider,
  SttTranscriptionResult,
  TtsSynthesisResult,
} from './voice-provider.interface.js';
import type { VoiceSettingsDto } from '../../voice/dto/voice-stream.dto.js';

@Injectable()
export class MockSttProvider implements SttProvider {
  readonly name = 'mock-whisper-stt';
  private readonly logger = new Logger(MockSttProvider.name);

  async transcribe(
    audioBuffer: Buffer,
    mimeType: string,
  ): Promise<SttTranscriptionResult> {
    this.logger.debug(
      `[MockSTT] 음성 전사 요청: ${audioBuffer.length} bytes (mime: ${mimeType})`,
    );

    // 모의 STT 변환 결과 반환
    return {
      text: 'Compare local OPFS caching with MongoDB change streams',
      confidence: 0.98,
    };
  }
}

@Injectable()
export class MockTtsProvider implements TtsProvider {
  readonly name = 'mock-piper-tts';
  private readonly logger = new Logger(MockTtsProvider.name);

  async synthesize(
    text: string,
    settings?: VoiceSettingsDto,
  ): Promise<TtsSynthesisResult> {
    const voice = settings?.selectedVoice ?? 'JARVIS British AI';
    const speed = settings?.speechSpeed ?? 1.0;

    this.logger.debug(
      `[MockTTS] 음성 합성 요청: "${text.slice(0, 30)}..." (voice: ${voice}, speed: ${speed})`,
    );

    // 유효한 최소 PCM WAV 오디오 버퍼 생성 (Sample rate 16000Hz, 16bit mono, 0.5초 무음/톤)
    const wavBuffer = this.generateValidWavBuffer(16000, 0.5);

    // 텍스트 글자 수 및 배속을 고려한 모의 duration 계산 (예: "0:05")
    const durationSeconds = Math.max(
      2,
      Math.min(60, Math.round((text.length / 15) / speed)),
    );
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return {
      audioBuffer: wavBuffer,
      duration: durationStr,
      format: 'wav',
      mimeType: 'audio/wav',
    };
  }

  /**
   * 브라우저에서 안전하게 재생 가능한 최소 유효 16bit PCM WAV 버퍼 생성
   */
  private generateValidWavBuffer(sampleRate = 16000, durationSeconds = 0.5): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const dataSize = numSamples * blockAlign;
    const buffer = Buffer.alloc(44 + dataSize);

    // 1. RIFF 헤더
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // 2. fmt 청크
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // 3. data 청크
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // 4. PCM 샘플 데이터 (경미한 440Hz 사인파 톤을 넣어 무음 재생 에러 방지)
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * 440 * t) * 1000; // 낮은 볼륨의 톤
      buffer.writeInt16LE(Math.floor(sample), 44 + i * 2);
    }

    return buffer;
  }
}
