import type { VoiceSettingsDto } from '../../voice/dto/voice-stream.dto.js';

export interface SttTranscriptionResult {
  text: string;
  confidence?: number;
}

export interface TtsSynthesisResult {
  audioBuffer: Buffer;
  duration: string; // e.g. '0:05' or '0:38'
  format: 'wav' | 'opus' | 'webm';
  mimeType: string;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<SttTranscriptionResult>;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, settings?: VoiceSettingsDto): Promise<TtsSynthesisResult>;
}
