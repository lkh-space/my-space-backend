import { BaseDomainException } from '../../common/exceptions/domain.exception.js';

/**
 * 폴더를 찾을 수 없는 경우 발생하는 예외
 */
export class FolderNotFoundException extends BaseDomainException {
  readonly code = 'FOLDER_NOT_FOUND';

  constructor(folderId: string) {
    super(`폴더를 찾을 수 없습니다: ${folderId}`, { folderId });
  }
}

/**
 * 동일 부모 경로에 동일 이름의 폴더가 이미 존재하는 경우 발생하는 예외
 */
export class FolderAlreadyExistsException extends BaseDomainException {
  readonly code = 'FOLDER_ALREADY_EXISTS';

  constructor(name: string, parentId?: string | null) {
    super(`해당 위치에 이미 동일한 이름의 폴더가 존재합니다: ${name}`, {
      name,
      parentId,
    });
  }
}

/**
 * 폴더 이동 시 자기 자신 또는 하위 폴더로 이동하여 순환 참조가 발생하는 경우
 */
export class FolderCyclicDependencyException extends BaseDomainException {
  readonly code = 'FOLDER_CYCLIC_DEPENDENCY';

  constructor(folderId: string, targetParentId: string) {
    super('폴더를 자기 자신이나 하위 폴더로 이동할 수 없습니다.', {
      folderId,
      targetParentId,
    });
  }
}

/**
 * 문서를 찾을 수 없는 경우 발생하는 예외
 */
export class DocumentNotFoundException extends BaseDomainException {
  readonly code = 'DOCUMENT_NOT_FOUND';

  constructor(documentId: string) {
    super(`문서를 찾을 수 없습니다: ${documentId}`, { documentId });
  }
}

/**
 * 리비전 이력을 찾을 수 없는 경우 발생하는 예외
 */
export class RevisionNotFoundException extends BaseDomainException {
  readonly code = 'REVISION_NOT_FOUND';

  constructor(documentId: string, version: number) {
    super(`해당 버전의 리비전을 찾을 수 없습니다 (version: ${version})`, {
      documentId,
      version,
    });
  }
}

/**
 * 유효하지 않은 이미지/에셋 파일인 경우 발생하는 예외
 */
export class InvalidAssetException extends BaseDomainException {
  readonly code = 'INVALID_ASSET_FILE';

  constructor(reason: string) {
    super(`유효하지 않은 에셋 파일입니다: ${reason}`, { reason });
  }
}
