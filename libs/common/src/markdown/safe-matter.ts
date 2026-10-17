// oxlint-disable-next-line no-restricted-imports
import matter from 'gray-matter';
import { UnsafeFrontmatterException } from './unsafe-frontmatter.exception.js';

export { UnsafeFrontmatterException };

const rejectUnsafeEngine = (engineName: string) => () => {
  throw new UnsafeFrontmatterException(
    `보안 정책 위반: '${engineName}' 스크립트 실행 프론트매터 엔진은 허용되지 않습니다.`,
    { engine: engineName },
  );
};

/**
 * eval(str)을 유발하거나 임의 코드를 실행할 수 있는 위험한 엔진 차단 목록
 */
const SAFE_ENGINES: Record<string, { parse: () => never; stringify?: () => never }> = {
  javascript: {
    parse: rejectUnsafeEngine('javascript'),
    stringify: rejectUnsafeEngine('javascript'),
  },
  js: {
    parse: rejectUnsafeEngine('js'),
    stringify: rejectUnsafeEngine('js'),
  },
  coffee: {
    parse: rejectUnsafeEngine('coffee'),
    stringify: rejectUnsafeEngine('coffee'),
  },
  coffeescript: {
    parse: rejectUnsafeEngine('coffeescript'),
    stringify: rejectUnsafeEngine('coffeescript'),
  },
  cson: {
    parse: rejectUnsafeEngine('cson'),
    stringify: rejectUnsafeEngine('cson'),
  },
};

/**
 * RCE 방지 및 전역 캐시(matter.cache) 메모리 누수 방지를 위한 기본 안전 옵션
 */
const DEFAULT_SAFE_OPTIONS = {
  language: 'yaml',
  engines: SAFE_ENGINES,
} as const;

export type SafeMatterInput = string | Buffer;
export type SafeMatterFile<I extends SafeMatterInput = string> = matter.GrayMatterFile<I>;

/**
 * 안전한 마크다운 Frontmatter 파서
 *
 * 1. JavaScript/CoffeeScript 엔진을 통한 RCE(원격 코드 실행)를 원천 차단합니다.
 * 2. 항상 명시적 옵션 객체를 전달하여 gray-matter 내부의 무제한 전역 캐시(matter.cache) 메모리 누수를 방지합니다.
 */
export function safeMatter<I extends SafeMatterInput>(
  input: I | { content: I },
  options?: Record<string, unknown>,
): matter.GrayMatterFile<I> {
  const mergedOptions = {
    ...DEFAULT_SAFE_OPTIONS,
    ...options,
    engines: {
      ...DEFAULT_SAFE_OPTIONS.engines,
      ...(options?.engines as Record<string, unknown>),
    },
  };

  return matter(input as any, mergedOptions as any) as matter.GrayMatterFile<I>;
}

/**
 * 안전한 Frontmatter stringify
 */
safeMatter.stringify = function stringify(
  file: string | object,
  data?: object,
  options?: Record<string, unknown>,
): string {
  const mergedOptions = {
    ...DEFAULT_SAFE_OPTIONS,
    ...options,
    engines: {
      ...DEFAULT_SAFE_OPTIONS.engines,
      ...(options?.engines as Record<string, unknown>),
    },
  };

  return matter.stringify(file as any, data as any, mergedOptions as any);
};

/**
 * Frontmatter 존재 여부 검사
 */
safeMatter.test = function test(
  input: SafeMatterInput,
  options?: Record<string, unknown>,
): boolean {
  return matter.test(input as any, options as any);
};
