import { BaseDomainException } from '../../common/exceptions/domain.exception.js';

/**
 * 암호화된 PDF이나 비밀번호가 제공되지 않은 경우
 */
export class PdfPasswordRequiredException extends BaseDomainException {
  readonly code = 'PDF_PASSWORD_REQUIRED';

  constructor(
    message = '암호화된 PDF 파일입니다. 비밀번호를 입력해주세요.',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/**
 * 제공된 비밀번호가 일치하지 않는 경우
 */
export class PdfInvalidPasswordException extends BaseDomainException {
  readonly code = 'PDF_INVALID_PASSWORD';

  constructor(
    message = 'PDF 비밀번호가 일치하지 않습니다.',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/**
 * 암호 해제 요청 시 파일이 암호화되어 있지 않은 경우
 */
export class PdfNotProtectedException extends BaseDomainException {
  readonly code = 'PDF_NOT_PASSWORD_PROTECTED';

  constructor(
    message = '암호화되지 않은 일반 PDF 파일입니다.',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/**
 * 병합 파일 개수 제약(2개 미만 또는 20개 초과)을 위반한 경우
 */
export class PdfFileCountException extends BaseDomainException {
  readonly code: string;

  constructor(
    type: 'MIN' | 'MAX',
    count: number,
    details?: Record<string, unknown>,
  ) {
    const isMin = type === 'MIN';
    const code = isMin
      ? 'PDF_MIN_FILE_COUNT_NOT_MET'
      : 'PDF_MAX_FILE_COUNT_EXCEEDED';
    const message = isMin
      ? `PDF 병합을 위해 최소 2개 이상의 파일이 필요합니다. (현재: ${count}개)`
      : `1회 요청 시 최대 20개의 파일까지 병합 가능합니다. (현재: ${count}개)`;
    super(message, { count, ...details });
    this.code = code;
  }
}

/**
 * 단일 또는 총합 파일 크기 한도를 초과한 경우
 */
export class PdfFileSizeExceededException extends BaseDomainException {
  readonly code = 'PDF_FILE_SIZE_EXCEEDED';

  constructor(
    message = 'PDF 파일 크기 제한을 초과했습니다.',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/**
 * 요청한 페이지 범위가 유효하지 않은 경우
 */
export class PdfInvalidPageRangeException extends BaseDomainException {
  readonly code = 'PDF_INVALID_PAGE_RANGE';

  constructor(
    message = '유효하지 않은 페이지 범위입니다.',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

/**
 * PDF 파일이 손상되었거나 유효한 PDF 형식이 아닌 경우
 */
export class PdfCorruptedFileException extends BaseDomainException {
  readonly code = 'PDF_CORRUPTED_FILE';

  constructor(
    message = '손상되었거나 유효하지 않은 PDF 파일입니다.',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}
