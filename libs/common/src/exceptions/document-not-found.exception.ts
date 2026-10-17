import { BaseDomainException } from './domain.exception.js';

/**
 * 문서를 찾을 수 없는 경우 발생하는 예외
 */
export class DocumentNotFoundException extends BaseDomainException {
  readonly code = 'DOCUMENT_NOT_FOUND';

  constructor(documentId: string) {
    super(`문서를 찾을 수 없습니다: ${documentId}`, { documentId });
  }
}
