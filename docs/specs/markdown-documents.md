---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-05
---

# 마크다운 문서 도메인 사양서 (Markdown Documents Specification)

## 1. 개요 (Summary)
개인 맞춤형 Markdown 문서를 작성, 저장, 분류(Folder, Tag), 버전 이력 관리(Revision), 검색(OpenSearch), 그리고 파일 입출력(Import, Markdown/PDF Export) 및 첨부 이미지 관리(MinIO)를 지원하는 백엔드 코어 도메인 사양서입니다.

---

## 2. 목표 및 비목표 (Goals / Non-goals)

### 목표 (Goals)
* **저장소 역할 분리**:
  * PostgreSQL (Prisma): 문서, 폴더, 태그, 리비전 메타데이터 및 관계 관리
  * MinIO: 마크다운 원문 파일(`docs/{ownerId}/{docId}/...`) 및 첨부 이미지(`images/{ownerId}/...`) 저장
  * OpenSearch: 제목(가중치 3배), 본문(스니펫 하이라이트), 태그 풀텍스트 검색
* **계층형 폴더 (Folder)**:
  * 물리적/계층적 트리 구조 지원, 순환 참조 검증(`FOLDER_CYCLIC_DEPENDENCY`), 동일 경로 중복 방지(`FOLDER_ALREADY_EXISTS`)
* **논리적 태그 (Tag)**:
  * 다중 태그(N:M) 연결 및 사용자별 태그 사용 통계 제공
* **수정 이력 (Revision History)**:
  * 본문/제목 변경 시 이전 버전 자동 보존, 버전별 내용 조회, 버전 간 비교(`compare`), 과거 버전 복원(`restore`)
* **파일 입출력 (Import/Export)**:
  * `.md` 파일 업로드 시 Frontmatter 및 제목 자동 추출 임포트
  * `.md` 파일 및 `pdf-lib` 기반 PDF 파일 내보내기 지원
* **보안 및 사용자 격리**:
  * Authelia SSO ForwardAuth 헤더 기반으로 모든 데이터와 파일 접근을 `ownerId` 단위로 엄격히 격리

### 제외 대상 (Non-goals)
* 사용자 간 공유, 실시간 협업, 댓글, 소셜 피드, 공개 블로그 기능

---

## 3. 유스케이스 (Use Cases)

| 유스케이스 ID | 액터 | 목표 | 주요 흐름 요약 |
| :--- | :--- | :--- | :--- |
| `UC-M01` | 사용자 | 마크다운 문서 생성 | 제목, 본문, 폴더, 태그를 입력받아 DB 및 MinIO에 저장하고 OpenSearch에 색인 |
| `UC-M02` | 사용자 | 문서 목록 및 상세 조회 | 폴더/태그 필터링 목록 조회 및 MinIO 원문 본문 로드 |
| `UC-M03` | 사용자 | 문서 수정 및 리비전 보존 | 내용 수정 시 기존 버전을 리비전으로 저장하고 신규 버전으로 갱신 |
| `UC-M04` | 사용자 | 리비전 비교 및 복원 | 과거 버전과 현재 버전을 비교하고, 과거 시점의 내용으로 새 리비전 생성 복원 |
| `UC-M05` | 사용자 | 계층형 폴더 관리 | 폴더 생성, 트리 조회, 수정(이동 및 이름 변경), 삭제 |
| `UC-M06` | 사용자 | 문서 풀텍스트 검색 | OpenSearch를 통해 본문 키워드 검색 및 스니펫 하이라이트 확인 |
| `UC-M07` | 사용자 | 이미지 에셋 업로드 | Magic bytes 검증 후 MinIO 에셋 버킷에 저장하고 마크다운 삽입용 URL 반환 |
| `UC-M08` | 사용자 | Import 및 Export | `.md` 파일 임포트 및 `.md`, PDF 파일 다운로드 |

---

## 4. 비즈니스 규칙 (Business Rules)

* **`BR-M01` (사용자 격리)**:
  - 모든 폴더, 문서, 태그, 리비전, 이미지 에셋은 `ownerId`(`req.user.username`)에 종속되며, 타인의 데이터에 대한 읽기/쓰기를 엄격히 금지한다.
* **`BR-M02` (폴더 순환 참조 방지)**:
  - 폴더 이동 시 자기 자신(`folderId === parentId`) 또는 자신의 하위 자손 폴더를 부모로 설정할 수 없다 (`FOLDER_CYCLIC_DEPENDENCY`).
* **`BR-M03` (폴더 중복 방지)**:
  - 동일한 부모 폴더 경로 내에서는 동일한 이름의 폴더가 존재할 수 없다 (`FOLDER_ALREADY_EXISTS`).
* **`BR-M04` (리비전 자동 생성)**:
  - 문서 수정 시 본문(`content`) 또는 제목(`title`), Frontmatter에 변경이 발생한 경우에만 기존 버전을 `DocumentRevision` 및 MinIO `revisions/` 경로에 보존하고 `currentVersion`을 1 증가시킨다.
* **`BR-M05` (에셋 파일 검증)**:
  - 이미지 파일은 10MB 이하이어야 하며, 허용된 MIME 타입(JPEG, PNG, GIF, WebP, SVG)과 실제 Magic bytes가 일치해야 한다 (`INVALID_ASSET_FILE`).

---

## 5. 인터페이스 및 API 규격 (Interface / API)

### 5.1. 엔드포인트 목록
* `POST /api/v1/markdown/documents`: 문서 생성
* `GET /api/v1/markdown/documents`: 문서 목록 조회 (페이징, 폴더, 태그 필터링)
* `GET /api/v1/markdown/documents/:id`: 문서 상세 조회 (메타데이터 + MinIO 본문)
* `PUT /api/v1/markdown/documents/:id`: 문서 수정 (리비전 생성)
* `DELETE /api/v1/markdown/documents/:id`: 문서 삭제
* `POST /api/v1/markdown/documents/import`: `.md` 파일 임포트
* `GET /api/v1/markdown/documents/:id/export/md`: `.md` 파일 내보내기
* `GET /api/v1/markdown/documents/:id/export/pdf`: PDF 파일 내보내기
* `GET /api/v1/markdown/documents/:id/revisions`: 리비전 목록 조회
* `GET /api/v1/markdown/documents/:id/revisions/compare`: 리비전 비교
* `GET /api/v1/markdown/documents/:id/revisions/:version`: 리비전 상세 조회
* `POST /api/v1/markdown/documents/:id/revisions/:version/restore`: 리비전 복원
* `GET /api/v1/markdown/folders`: 전체 계층 폴더 트리 조회
* `POST /api/v1/markdown/folders`: 폴더 생성
* `PATCH /api/v1/markdown/folders/:id`: 폴더 수정 및 이동
* `DELETE /api/v1/markdown/folders/:id`: 폴더 삭제
* `GET /api/v1/markdown/tags`: 태그 목록 및 사용량 조회
* `GET /api/v1/markdown/search`: OpenSearch 풀텍스트 검색
* `POST /api/v1/markdown/assets/upload`: 첨부 이미지 업로드
* `GET /api/v1/markdown/assets/*`: 첨부 이미지 스트리밍

---

## 6. 예외 처리 매핑 (`DOMAIN_ERROR_HTTP_MAP`)

| 에러 코드 | 발생 예외 클래스 | HTTP 상태 코드 |
| :--- | :--- | :--- |
| `FOLDER_NOT_FOUND` | `FolderNotFoundException` | `404 Not Found` |
| `FOLDER_ALREADY_EXISTS` | `FolderAlreadyExistsException` | `409 Conflict` |
| `FOLDER_CYCLIC_DEPENDENCY` | `FolderCyclicDependencyException` | `400 Bad Request` |
| `DOCUMENT_NOT_FOUND` | `DocumentNotFoundException` | `404 Not Found` |
| `REVISION_NOT_FOUND` | `RevisionNotFoundException` | `404 Not Found` |
| `INVALID_ASSET_FILE` | `InvalidAssetException` | `400 Bad Request` |
