# 기능 및 API 명세 (Specifications)

이 디렉토리는 프로젝트에서 제공하거나 구현 예정인 개별 유틸리티 도메인의 비즈니스 요구사항, 인터페이스 계약 및 백엔드 API 설계 사양서를 수집하고 관리하는 공간입니다.

---

## 스펙 작성 규칙

* **기능/도메인별 개별 파일 작성**:
  - 도메인 단위마다 독립된 마크다운 파일로 분리하여 작성하며, 파일명은 `kebab-case.md` 방식을 사용합니다 (예: `pdf-parser.md`, `dbml-tools.md`).
* **필수 프론트매터(Front-matter) 기재**:
  - 스펙 문서 최상단에는 반드시 아래의 YAML 프론트매터를 선언해야 합니다:
  ```yaml
  ---
  status: draft | review | approved | implemented | deprecated
  owner: <작성자 이름 / GitHub 핸들러>
  last-updated: YYYY-MM-DD
  ---
  ```
  - **status 값의 의미**:
    - `draft`: 사양 구상 및 초안 작성 중인 단계
    - `review`: 문서 완성을 마친 뒤 구조나 비즈니스 설계 검토를 거치는 단계
    - `approved`: 구현을 진행해도 좋다고 기술적/비즈니스적 합의가 완료된 단계
    - `implemented`: 실제 구현 및 테스트 검증이 소스 코드에 최종 반영 완료된 단계
    - `deprecated`: 레거시 기능이 되어 더 이상 유효하지 않은 스펙으로 분류된 단계

---

## 권장되는 스펙 구조 (Recommended Sections)

1. **개요 (Summary)**: 기능의 목적과 개발 필요성을 1~2문장으로 간결하게 서술합니다.
2. **목표 및 제외 대상 (Goals / Non-goals)**: 구현할 범위와 명시적으로 제외할 범위를 명확히 정의합니다.
3. **유스케이스 (Use cases)**: 사용자가 이 기능으로부터 얻는 구체적인 효용과 흐름을 `UC-XX` 번호와 함께 기술합니다.
4. **비즈니스 규칙 (Business Rules)**: 데이터 유효성, 도메인 제약조건을 `BR-XX` 식별자와 함께 명시합니다.
5. **인터페이스 및 API 스펙 (Interface / API)**: 엔드포인트 경로, HTTP 메서드, 요청/응답 DTO 스키마 명세를 기록합니다.
6. **동작 상세 및 에러 핸들링 (Behavior & Errors)**: 정상 시나리오(Happy Path)와 예외 시 던져지는 HTTP Status 및 에러 응답 규격을 기술합니다.
7. **오픈 질문 (Open questions)**: 추가 검토나 결정이 필요한 사항들을 정리합니다.

> [!NOTE]
> 설계 내용 중 아키텍처적 의사결정(외부 인프라 연동, 프레임워크 선택 등)이 수반되는 사항은 **[ADR](../adr/)**로 분리하여 작성한 뒤 본 사양서에서 링크로 참조합니다.

---

## 기능 명세 목록 (Index)

| 스펙 문서 | 설계 요약 | 상태 |
| :--- | :--- | :--- |
| [error-handling](./error-handling.md) | 전역 에러 처리 및 커스텀 예외 체계 사양서 (BaseDomainException, ApiException, AllExceptionsFilter) | implemented |
| [config](./config.md) | 환경 설정 및 ConfigService 사양서 (Zod 스키마 검증, registerAs 네임스페이스) | implemented |
| [pdf-tools](./pdf-tools.md) | PDF 조작 및 유틸리티 도메인 사양서 (PDF 병합, 범위 분할, 전권 ZIP 분할) | implemented |
