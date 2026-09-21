import { describe, it, expect } from 'vitest';
import { initE2ETest } from './lib/init-e2e-test.js';

describe('AppController (e2e)', () => {
  const ctx = initE2ETest();

  it('/ (GET)', async () => {
    // when
    const res = await ctx.req.get('/').expect(200);

    // then
    expect(res.text).toBe('Hello World!');
  });
});
