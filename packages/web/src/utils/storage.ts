import { config } from '@/config';

const STORAGE_PREFIX = 'zenith:';

/** Stable browser-storage namespace for this deployed derived project. */
export function scopedStorageKey(key: string): string {
  if (key.startsWith(`${STORAGE_PREFIX}${config.deploymentId}:`)) return key;
  return `${STORAGE_PREFIX}${config.deploymentId}:${key}`;
}

function isScopedKey(key: string): boolean {
  return key.startsWith(`${STORAGE_PREFIX}${config.deploymentId}:`);
}

/**
 * Make all first-party direct Storage API calls deployment-scoped.
 * The facade deliberately exposes only this deployment's keys to the app and
 * makes clear() safe: it cannot delete another derived project's data.
 */
function createScopedStorage(source: Storage): Storage {
  const scoped = (key: string) => scopedStorageKey(String(key));
  const ownKeys = () => {
    const keys: string[] = [];
    for (let i = 0; i < source.length; i += 1) {
      const key = source.key(i);
      if (key && isScopedKey(key)) keys.push(key);
    }
    return keys;
  };

  return {
    get length() { return ownKeys().length; },
    key(index: number): string | null {
      const key = ownKeys()[index];
      return key ? key.slice(`${STORAGE_PREFIX}${config.deploymentId}:`.length) : null;
    },
    getItem(key: string): string | null { return source.getItem(scoped(key)); },
    setItem(key: string, value: string): void { source.setItem(scoped(key), String(value)); },
    removeItem(key: string): void { source.removeItem(scoped(key)); },
    clear(): void { ownKeys().forEach((key) => source.removeItem(key)); },
  } as Storage;
}

let installed = false;

export function installScopedStorage(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    const local = createScopedStorage(window.localStorage);
    const session = createScopedStorage(window.sessionStorage);
    Object.defineProperty(window, 'localStorage', { configurable: true, value: local });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: session });
  } catch {
    // Private browsing / restricted WebViews may reject replacement; callers
    // already handle Storage errors and deployment-specific explicit keys still work.
  }
}

export const storageNamespace = `${STORAGE_PREFIX}${config.deploymentId}`;
