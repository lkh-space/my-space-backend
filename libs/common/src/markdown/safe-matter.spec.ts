import { describe, it, expect } from 'vitest';
// oxlint-disable-next-line no-restricted-imports
import matter from 'gray-matter';
import { safeMatter } from './safe-matter.js';
import { UnsafeFrontmatterException } from './unsafe-frontmatter.exception.js';

describe('safeMatter 단위 테스트', () => {
  describe('정상 마크다운 및 YAML Frontmatter 파싱', () => {
    it('유효한 YAML Frontmatter와 본문을 정상적으로 분리하여 파싱해야 한다', () => {
      // given
      const rawMarkdown = `---
title: "안전한 마크다운"
tags: ["security", "audit"]
published: true
---
# 본문 제목
안전하게 파싱된 마크다운 내용입니다.`;

      // when
      const result = safeMatter(rawMarkdown);

      // then
      expect(result.data.title).toBe('안전한 마크다운');
      expect(result.data.tags).toEqual(['security', 'audit']);
      expect(result.data.published).toBe(true);
      expect(result.content.trim()).toBe('# 본문 제목\n안전하게 파싱된 마크다운 내용입니다.');
    });

    it('Frontmatter가 없는 일반 마크다운 텍스트도 정상적으로 처리해야 한다', () => {
      // given
      const rawMarkdown = '# 단순 마크다운\n헤더만 있는 본문입니다.';

      // when
      const result = safeMatter(rawMarkdown);

      // then
      expect(result.data).toEqual({});
      expect(result.content.trim()).toBe('# 단순 마크다운\n헤더만 있는 본문입니다.');
    });

    it('본문에 자바스크립트 코드 블럭(```javascript ...)이 포함되어 있어도 정상 파싱되어야 한다', () => {
      // given
      const rawMarkdown = `---
title: "JS 코드 예제"
---
# 코드 예시

\`\`\`javascript
const greeting = "Hello, world!";
console.log(greeting);
\`\`\`

본문 설명입니다.`;

      // when
      const result = safeMatter(rawMarkdown);

      // then
      expect(result.data.title).toBe('JS 코드 예제');
      expect(result.content).toContain('```javascript');
      expect(result.content).toContain('const greeting = "Hello, world!";');
    });

    it('Frontmatter 없이 본문 시작부터 자바스크립트 코드 블럭이 있어도 에러 없이 처리되어야 한다', () => {
      // given
      const rawMarkdown = `\`\`\`js
function add(a, b) {
  return a + b;
}
\`\`\``;

      // when
      const result = safeMatter(rawMarkdown);

      // then
      expect(result.data).toEqual({});
      expect(result.content).toContain('function add(a, b)');
    });
  });

  describe('악성 Frontmatter RCE 차단 검증', () => {
    it('---js 엔진 페이로드 입력 시 eval이 실행되지 않고 UnsafeFrontmatterException이 발생해야 한다', () => {
      // given
      let executed = false;
      (globalThis as Record<string, unknown>).__test_pwned__ = () => {
        executed = true;
      };

      const maliciousPayload = `---js
{
  title: (function() {
    globalThis.__test_pwned__();
    return "hacked";
  })()
}
---
# 본문`;

      // when & then
      expect(() => safeMatter(maliciousPayload)).toThrow(UnsafeFrontmatterException);
      expect(executed).toBe(false);

      delete (globalThis as Record<string, unknown>).__test_pwned__;
    });

    it('---javascript, ---coffee, ---coffeescript, ---cson 등의 위험한 엔진 페이로드도 모두 차단해야 한다', () => {
      // given
      const payloads = [
        '---javascript\n{ title: "eval-attack" }\n---\n본문',
        '---coffee\ntitle: "coffee-attack"\n---\n본문',
        '---coffeescript\ntitle: "coffeescript-attack"\n---\n본문',
        '---cson\ntitle: "cson-attack"\n---\n본문',
      ];

      // when & then
      for (const payload of payloads) {
        expect(() => safeMatter(payload)).toThrow(UnsafeFrontmatterException);
      }
    });
  });

  describe('전역 캐시(matter.cache) 메모리 누수 방지 검증', () => {
    it('safeMatter 호출 시 gray-matter의 전역 캐시(matter.cache)에 키가 등록되지 않아야 한다', () => {
      // given
      const matterAny = matter as unknown as { cache: Record<string, unknown> };
      const uniqueContent = `---
title: "캐시 방지 테스트 ${Date.now()}"
---
고유 본문 내용입니다.`;

      // when
      safeMatter(uniqueContent);

      // then
      expect(matterAny.cache[uniqueContent]).toBeUndefined();
    });
  });

  describe('stringify 및 유틸리티 검증', () => {
    it('safeMatter.stringify를 통해 데이터와 본문을 올바른 마크다운으로 직렬화해야 한다', () => {
      // given
      const content = '직렬화할 마크다운 본문';
      const data = { title: '새 문서', author: 'admin' };

      // when
      const output = safeMatter.stringify(content, data);

      // then
      expect(output).toContain('title: 새 문서');
      expect(output).toContain('author: admin');
      expect(output).toContain('직렬화할 마크다운 본문');
    });

    it('safeMatter.test를 통해 Frontmatter 존재 여부를 판별할 수 있어야 한다', () => {
      // given
      const withFrontmatter = '---\ntitle: Test\n---\n본문';
      const withoutFrontmatter = '# 제목만 있음';

      // when & then
      expect(safeMatter.test(withFrontmatter)).toBe(true);
      expect(safeMatter.test(withoutFrontmatter)).toBe(false);
    });
  });
});
