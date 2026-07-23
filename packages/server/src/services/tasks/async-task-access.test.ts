import { describe, expect, it } from 'vitest';
import { canAccessAsyncTaskForScope } from './async-tasks.service';

describe('async task owner access', () => {
  it('prevents a publisher from reading or operating a system-owned notification task', () => {
    const systemTask = { createdBy: 1 };
    const publisher = { userId: 27, global: false };
    expect(canAccessAsyncTaskForScope(systemTask, publisher)).toBe(false);
    expect(canAccessAsyncTaskForScope(systemTask, { userId: 1, global: false })).toBe(true);
    expect(canAccessAsyncTaskForScope(systemTask, { userId: 27, global: true })).toBe(true);
  });
});
