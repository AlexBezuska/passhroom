import { describe, expect, it } from 'vitest';

describe('integration', () => {
  it('is skipped unless enabled', async () => {
    if (process.env.RUN_INTEGRATION_TESTS !== 'true') return;
    expect(process.env.DATABASE_URL).toBeTruthy();
  });
});
