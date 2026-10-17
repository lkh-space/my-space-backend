---
status: implemented
owner: Keunhyeok Lim
last-updated: 2026-10-16
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
* **`BR-M02` (폴더 순환 참조 방지 및 재귀 CTE)**:
  - 폴더 이동 시 자기 자신(`folderId === parentId`) 또는 자신의 하위 자손 폴더를 부모로 설정할 수 없다 (`FOLDER_CYCLIC_DEPENDENCY`).
  - 조상 체인 검증은 N+1 단일 조회를 제거하고 재귀 CTE(`WITH RECURSIVE`) 단 1회의 쿼리로 수행하며, 최대 탐색 깊이를 64단계(`depth < 64`)로 제한하여 순환 사이클이 발생하더라도 무한 루프에 빠지지 않도록 방어한다.
* **`BR-M03` (폴더 중복 방지 및 루트 NULL 고유성)**:
  - 동일한 부모 폴더 경로 내에서는 동일한 이름의 폴더가 존재할 수 없다 (`FOLDER_ALREADY_EXISTS`).
  - PostgreSQL B-tree의 NULL 고유성 허점(NULL끼리는 고유하지 않음)을 방어하기 위해 DB 레벨에 루트 폴더 전용 부분 유니크 인덱스(`WHERE parent_id IS NULL`)를 적용하며, 동시 요청 경쟁 시의 `P2002` 충돌을 안전하게 `FolderAlreadyExistsException`(409 Conflict)으로 변환한다.
* **`BR-M04` (리비전 자동 생성)**:
  - 문서 수정 시 본문(`content`) 또는 제목(`title`), Frontmatter에 변경이 발생한 경우에만 기존 버전을 `DocumentRevision` 및 MinIO `revisions/` 경로에 보존하고 `currentVersion`을 1 증가시킨다.
* **`BR-M05` (에셋 파일 검증 및 DoS/XSS 방어)**:
  - 이미지 파일은 10MB 이하이어야 하며, 허용된 MIME 타입(JPEG, PNG, GIF, WebP, SVG)과 실제 Magic bytes가 일치해야 한다 (`INVALID_ASSET_FILE`).
  - `.md` 가져오기(`import`) 및 에셋 업로드 인터셉터에 `limits: { fileSize: 10MB, files: 1 }`를 적용하여 힙 메모리 고갈을 사전 방지한다.
  - SVG 파일 업로드 시 `<script>`, 인라인 이벤트 핸들러(`onload`, `onerror` 등), `javascript:` 링크 스킴, `<foreignObject>`, XXE 엔티티 선언 등 악성 스크립트/외부 엔티티가 포함된 파일은 저장을 거부한다 (`INVALID_ASSET_FILE`).
  - 에셋 스트리밍 서빙 시 MIME 스니핑 차단(`X-Content-Type-Options: nosniff`), 엄격한 CSP 샌드박스(`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`), 개인 파일 공유 캐시 차단(`Cache-Control: private, max-age=86400`) 헤더를 적용하며, SVG 파일은 `Content-Disposition: attachment`로 강제 다운로드 서빙하여 브라우저 저장형 XSS를 차단한다.
  - 에셋 스트리밍은 `pipeline`을 사용하여 S3 스트림 실패 시에도 프로세스 비정상 종료 없이 안전하게 정리되어야 한다.
* **`BR-M06` (안전한 프론트매터 파싱 및 RCE 방지)**:
  - 마크다운 파싱 시 임의 코드 실행(eval)을 유발할 수 있는 엔진(JavaScript, CoffeeScript 등)은 엄격히 차단되어야 하며, 이를 위반하는 파일이나 문서는 즉시 거부된다 (`MARKDOWN_UNSAFE_FRONTMATTER`). 또한 파서의 전역 캐시로 인한 메모리 누수가 발생하지 않아야 한다.
* **`BR-M07` (낙관적 동시성 잠금 및 Lost Update 방어)**:
  - 문서 수정(`PUT /api/v1/markdown/documents/:id`) 시 `If-Match` 헤더 또는 `expectedVersion` 필드를 통해 클라이언트가 수정 대상 버전을 명시할 수 있다.
  - 지정된 기대 버전과 DB 현재 버전이 일치하지 않거나, 동시 요청 경쟁 조건으로 인해 대상 버전 레코드 갱신에 실패한 경우 즉시 `DOCUMENT_VERSION_CONFLICT`(409 Conflict) 예외를 발생시키고 MinIO 스토리지를 원래 상태로 보상 롤백한다.
* **`BR-M08` (원자적 태그 일괄 해석 및 경쟁 방어)**:
  - 문서 생성 및 수정 시 지정된 태그 배열은 N+1 반복 쿼리 대신 `createMany({ skipDuplicates: true })` 및 `findMany({ where: { name: { in: cleanNames } } })`를 통해 단 2회의 쿼리로 원자적으로 해석 및 등록되어야 한다.
  - 동일한 태그를 생성하려는 동시 요청이 발생하더라도 `skipDuplicates: true`를 통해 DB 유니크 제약 충돌(`P2002`)을 원천 방어하고 일관성을 보장한다.
* **`BR-M09` (복합 정렬 인덱스 및 커서 기반 페이지네이션)**:
  - 대량 문서 목록 조회 시 Filesort 병목을 방지하기 위해 `(owner_id, updated_at DESC)`, `(owner_id, folder_id, updated_at DESC)` 복합 정렬 인덱스와 `document_tags` 역조회를 위한 `(tag_id)` 인덱스를 유지한다.
  - 대용량 데이터 환경에서의 깊은 오프셋 성능 저하를 방지하기 위해 커서 기반 페이징(`cursor`, `nextCursor`)을 지원하며, 동일 정렬 시 순서가 보장되도록 `[{ updatedAt: 'desc' }, { id: 'desc' }]`의 결정론적(deterministic) 정렬을 보장한다.
* **`BR-M10` (OpenSearch 검색 장애 전파, 하이라이트 XSS 방어 및 페이징 제한)**:
  - 검색 클러스터 장애 발생 시 빈 결과를 반환하여 장애를 은폐하지 않고 `SEARCH_SERVICE_UNAVAILABLE` (503 Service Unavailable) 예외를 클라이언트에 명확히 전파한다.
  - 하이라이트 스니펫 생성 시 `encoder: 'html'`을 필수로 적용하여 본문 내 악성 스크립트 특수문자가 HTML 엔티티로 인코딩되도록 하여 XSS 공격을 원천 방어한다.
  - OpenSearch 윈도우 한계 보호를 위해 검색 쿼리는 `page * limit <= 10,000`으로 제한하며, 색인 및 검색 필터 시 태그는 소문자(`toLowerCase()`)로 정규화한다.

---

## 5. 인터페이스 및 API 규격 (Interface / API)

### 5.1. 엔드포인트 목록
* `POST /api/v1/markdown/documents`: 문서 생성
* `GET /api/v1/markdown/documents`: 문서 목록 조회 (오프셋/커서 페이징, 폴더, 태그 필터링)
* `GET /api/v1/markdown/documents/:id`: 문서 상세 조회 (메타데이터 + MinIO 본문)
* `PUT /api/v1/markdown/documents/:id`: 문서 수정 (리비전 생성, `If-Match` 낙관적 잠금 지원)
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
| `DOCUMENT_VERSION_CONFLICT` | `DocumentVersionConflictException` | `409 Conflict` |
| `REVISION_NOT_FOUND` | `RevisionNotFoundException` | `404 Not Found` |
| `INVALID_ASSET_FILE` | `InvalidAssetException` | `400 Bad Request` |
| `MARKDOWN_UNSAFE_FRONTMATTER` | `UnsafeFrontmatterException` | `400 Bad Request` |
