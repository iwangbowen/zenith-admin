import { AsyncLocalStorage } from 'node:async_hooks';

export interface CmsGenerationContext {
  siteId: number;
  generationId: number;
  candidate: boolean;
}
const scope = new AsyncLocalStorage<CmsGenerationContext>();
export function cmsGenerationContext(): CmsGenerationContext | undefined { return scope.getStore(); }
export function withCmsGenerationContext<T>(context: CmsGenerationContext, fn: () => Promise<T>): Promise<T> {
  return scope.run(context, fn);
}
/** Definition caches have no generation dimension; scoped readers must bypass them. */
export function isCmsGenerationRead(): boolean { return scope.getStore() !== undefined; }
