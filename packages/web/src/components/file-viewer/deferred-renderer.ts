import { DEFAULT_RENDERER_DEFINITIONS } from '@file-viewer/core';
import type { FileRenderHandler, FileViewerRenderedInstance, FileViewerRendererPlugin } from '@file-viewer/core';

type Handler = FileRenderHandler<FileViewerRenderedInstance, HTMLDivElement>;
export type BrowserRenderer = FileViewerRendererPlugin<Handler>;

/** Keep every format available (also inside archives), and import its engine only on use. */
export function deferredRenderer(id: string, rendererIds: readonly string[], load: () => Promise<BrowserRenderer>): FileViewerRendererPlugin {
  let pending: Promise<BrowserRenderer> | undefined;
  const loadOnce = () => pending ??= load().catch((error: unknown) => { pending = undefined; throw error; });
  const definitions = DEFAULT_RENDERER_DEFINITIONS.filter((entry) => rendererIds.includes(entry.id));
  if (definitions.length !== rendererIds.length) throw new Error(`Missing file renderer definition: ${rendererIds.join(', ')}`);
  return {
    id,
    definitions,
    handlers: rendererIds.map((rendererId) => ({ rendererId, handler: async (buffer, target, type, context) => {
      const renderer = await loadOnce();
      const registration = renderer.handlers?.find((entry) => entry.rendererId === rendererId);
      if (!registration) throw new Error(`Missing file renderer handler: ${rendererId}`);
      if (target.tagName !== 'DIV') throw new Error('File preview requires a div rendering surface');
      return registration.handler(buffer, target as HTMLDivElement, type, context);
    } })),
  };
}
