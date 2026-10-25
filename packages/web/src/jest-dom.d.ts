// Vitest 5.0.5 changed Assertion to <return type, actual value>. jest-dom 7.0.1
// still augments the former single-parameter shape, so mirror its matchers on
// the current interface until the upstream declaration catches up.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- mirrors jest-dom's own augmentation pattern
  interface Assertion<R extends void | Promise<void> = void, _T = unknown>
    extends TestingLibraryMatchers<unknown, R> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- mirrors jest-dom's own augmentation pattern
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}

export {};
