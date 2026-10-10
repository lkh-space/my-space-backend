import { BaseDomainException } from '@app/common/exceptions/domain.exception.js';

export class SessionNotFoundException extends BaseDomainException {
  readonly code = 'AI_SESSION_NOT_FOUND';

  constructor(sessionId: string) {
    super(`해당 신경망 세션을 찾을 수 없습니다: ${sessionId}`);
  }
}

export class SessionInactiveException extends BaseDomainException {
  readonly code = 'AI_SESSION_INACTIVE';

  constructor(sessionId: string) {
    super(`해당 신경망 세션이 비활성 상태입니다: ${sessionId}`);
  }
}

export class AudioFileNotFoundException extends BaseDomainException {
  readonly code = 'AI_AUDIO_NOT_FOUND';

  constructor(audioId: string) {
    super(`합성 음성 파일을 찾을 수 없거나 만료되었습니다: ${audioId}`);
  }
}

export class AudioPayloadTooLargeException extends BaseDomainException {
  readonly code = 'AI_AUDIO_PAYLOAD_TOO_LARGE';

  constructor(maxSizeMb = 10) {
    super(`오디오 파일 용량이 허용치(${maxSizeMb}MB)를 초과했습니다.`);
  }
}

export class InvalidAudioFormatException extends BaseDomainException {
  readonly code = 'AI_AUDIO_INVALID_FORMAT';

  constructor(mimeType: string) {
    super(`지원하지 않는 오디오 포맷입니다: ${mimeType}`);
  }
}

export class SttProcessingException extends BaseDomainException {
  readonly code = 'AI_STT_FAILED';

  constructor(message = '음성 인식(STT) 처리 중 오류가 발생했습니다.') {
    super(message);
  }
}

export class TtsSynthesisException extends BaseDomainException {
  readonly code = 'AI_TTS_FAILED';

  constructor(message = '음성 합성(TTS) 처리 중 오류가 발생했습니다.') {
    super(message);
  }
}

export class StreamNotFoundException extends BaseDomainException {
  readonly code = 'AI_STREAM_NOT_FOUND';

  constructor(sessionId: string) {
    super(`중단할 활성 스트림을 찾을 수 없습니다: ${sessionId}`);
  }
}
