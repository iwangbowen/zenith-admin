import { setDefaultFileViewerAssetBaseUrl } from '@file-viewer/core/assets';
import { deferredRenderer } from './deferred-renderer';

// Replaces the virtual registry's asset-base initialization; the build plugin still copies assets.
setDefaultFileViewerAssetBaseUrl(new URL(`${import.meta.env.BASE_URL}file-viewer/`, document.baseURI).href);

export const fileViewerRenderers = [
  deferredRenderer('word', ['office-word-openxml', 'office-word-binary', 'open-document'], () => import('@file-viewer/renderer-word').then((m) => m.wordRenderer)),
  deferredRenderer('spreadsheet', ['spreadsheet-openxml', 'spreadsheet-dbf'], () => import('@file-viewer/renderer-spreadsheet').then((m) => m.spreadsheetRenderer)),
  deferredRenderer('ofd', ['ofd'], () => import('@file-viewer/renderer-ofd').then((m) => m.ofdRenderer)),
  deferredRenderer('email', ['email'], () => import('@file-viewer/renderer-email').then((m) => m.emailRenderer)),
  deferredRenderer('mindmap', ['mindmap'], () => import('@file-viewer/renderer-mindmap').then((m) => m.mindmapRenderer)),
  deferredRenderer('drawing', ['drawing'], () => import('@file-viewer/renderer-drawing').then((m) => m.drawingRenderer)),
  deferredRenderer('data', ['data-asset'], () => import('@file-viewer/renderer-data').then((m) => m.dataRenderer)),
  deferredRenderer('geo', ['geo'], () => import('@file-viewer/renderer-geo').then((m) => m.geoRenderer)),
  deferredRenderer('text', ['code', 'markdown'], () => import('@file-viewer/renderer-text').then((m) => m.textRenderer)),
  deferredRenderer('archive', ['archive'], () => import('@file-viewer/renderer-archive').then((m) => m.archiveRenderer)),
  deferredRenderer('presentation', ['office-presentation-binary', 'office-presentation'], () => import('@file-viewer/renderer-presentation').then((m) => m.presentationRenderer)),
];
