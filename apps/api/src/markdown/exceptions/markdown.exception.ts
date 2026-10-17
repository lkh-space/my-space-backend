import { BaseDomainException } from '@app/common/exceptions/domain.exception.js';
export {
  FolderNotFoundException,
  DocumentNotFoundException,
  StorageObjectNotFoundException,
} from '@app/common';

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

/**
 * 문서 수정 시 버전 충돌(Lost Update 방지)이 발생한 경우의 예외
 */
export class DocumentVersionConflictException extends BaseDomainException {
  readonly code = 'DOCUMENT_VERSION_CONFLICT';

  constructor(
    documentId: string,
    expectedVersion?: number,
    currentVersion?: number,
  ) {
    super(
      `문서 '${documentId}'의 버전이 일치하지 않습니다. 다른 사용자에 의해 수정되었을 수 있습니다. (예상: ${expectedVersion ?? '미지정'}, 현재: ${currentVersion ?? '불명'})`,
      { documentId, expectedVersion, currentVersion },
    );
  }
}

/**
 * OpenSearch 등 검색 엔진 서비스 장애 예외
 */
export class SearchUnavailableException extends BaseDomainException {
  readonly code = 'SEARCH_SERVICE_UNAVAILABLE';

  constructor(detail?: string) {
    super(
      detail
        ? `검색 엔진 서비스를 일시적으로 사용할 수 없습니다: ${detail}`
        : '검색 엔진 서비스를 일시적으로 사용할 수 없습니다.',
      { detail },
    );
  }
}

/**
 * 에셋 접근 권한이 없거나 격리 위반 시 발생하는 예외
 */
export class AssetAccessDeniedException extends BaseDomainException {
  readonly code = 'ASSET_ACCESS_DENIED';

  constructor(message = '해당 에셋에 대한 접근 권한이 없습니다.') {
    super(message);
  }
}

/**
 * 업로드/가져오기한 마크다운 파일이 유효하지 않거나 누락된 경우 발생하는 예외
 */
export class InvalidMarkdownFileException extends BaseDomainException {
  readonly code = 'INVALID_MARKDOWN_FILE';

  constructor(message = '마크다운 파일이 제공되지 않았거나 내용이 유효하지 않습니다.') {
    super(message);
  }
}



