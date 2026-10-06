import { describe, it, expect } from 'vitest';
import { MarkdownChunker } from './markdown-chunker.js';

describe('MarkdownChunker (BDD 단위 테스트)', () => {
  it('빈 문자열이나 공백만 있는 문서는 빈 배열을 반환한다', () => {
    // given
    const emptyMarkdown = '   \n\n  ';

    // when
    const chunks = MarkdownChunker.chunk(emptyMarkdown);

    // then
    expect(chunks).toEqual([]);
  });

  it('Frontmatter 메타데이터를 제거하고 본문만 청크로 분할한다', () => {
    // given
    const markdownWithFrontmatter = `---
title: 테스트 문서
tags: [ai, nestjs]
---
# 첫 번째 헤딩
이것은 본문 내용입니다.
`;

    // when
    const chunks = MarkdownChunker.chunk(markdownWithFrontmatter);

    // then
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].heading).toBe('# 첫 번째 헤딩');
    expect(chunks[0].content).toContain('이것은 본문 내용입니다.');
    expect(chunks[0].content).not.toContain('title: 테스트 문서');
  });

  it('여러 헤딩이 존재할 때 헤딩 단위로 섹션을 구분하여 보존한다', () => {
    // given
    const multiHeadingDoc = `
# 소개
소개 섹션의 본문입니다.

## 아키텍처 개요
NestJS 모노레포와 Qdrant를 사용합니다.

### 세부 구현
각 앱은 독립적인 모듈로 구성됩니다.
`;

    // when
    const chunks = MarkdownChunker.chunk(multiHeadingDoc);

    // then
    expect(chunks.length).toBe(3);
    expect(chunks[0].heading).toBe('# 소개');
    expect(chunks[0].content).toContain('소개 섹션의 본문입니다.');
    expect(chunks[1].heading).toBe('## 아키텍처 개요');
    expect(chunks[1].content).toContain('NestJS 모노레포와 Qdrant를 사용합니다.');
    expect(chunks[2].heading).toBe('### 세부 구현');
    expect(chunks[2].content).toContain('각 앱은 독립적인 모듈로 구성됩니다.');
  });

  it('코드 블록 내부의 # 기호는 헤딩으로 인식하지 않고 코드 블록으로 온전히 유지한다', () => {
    // given
    const docWithCodeBlock = `
# 파이썬 가이드
아래는 파이썬 주석 예시입니다:

\`\`\`python
# 이것은 파이썬 주석이며 헤딩이 아닙니다
def hello():
    print("world")
\`\`\`
끝.
`;

    // when
    const chunks = MarkdownChunker.chunk(docWithCodeBlock);

    // then
    expect(chunks.length).toBe(1);
    expect(chunks[0].heading).toBe('# 파이썬 가이드');
    expect(chunks[0].content).toContain('# 이것은 파이썬 주석이며 헤딩이 아닙니다');
  });

  it('길이가 긴 섹션은 TARGET_CHUNK_SIZE 기준으로 여러 청크로 분할되고 순서대로 인덱싱된다', () => {
    // given
    const longParagraph = '가나다라마바사 아자차카타파하 1234567890\n'.repeat(50);
    const longDoc = `# 대용량 섹션\n${longParagraph}`;

    // when
    const chunks = MarkdownChunker.chunk(longDoc);

    // then
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].chunkIndex).toBe(1);
    expect(chunks[0].heading).toBe('# 대용량 섹션');
    expect(chunks[1].heading).toBe('# 대용량 섹션');
  });
});
