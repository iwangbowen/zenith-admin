import logger from './logger';

export interface IdentityRemoval {
  kind: 'user' | 'department';
  ids: readonly number[];
}
const listeners = new Set<(event: IdentityRemoval) => Promise<void>>();

export function onIdentityRemoval(listener: (event: IdentityRemoval) => Promise<void>): void {
  listeners.add(listener);
}

export function emitIdentityRemoval(event: IdentityRemoval): void {
  for (const listener of listeners) {
    void Promise.resolve().then(() => listener(event))
      .catch((error) => logger.error({ error, kind: event.kind }, 'Identity removal subscriber failed'));
  }
}
