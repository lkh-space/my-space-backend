import { BaseDomainException } from './domain.exception.js';

/**
 * 폴더를 찾을 수 없거나 타인의 폴더에 접근하려 할 때 발생하는 도메인 예외
 */
export class FolderNotFoundException extends BaseDomainException {
  readonly code = 'FOLDER_NOT_FOUND';

  constructor(folderId: string) {
    super(`폴더를 찾을 수 없습니다: ${folderId}`, { folderId });
  }
}
