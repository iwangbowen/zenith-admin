import { describe, expect, it } from 'vitest';
import { fileViewerRenderers } from './renderers';

describe('deferred registry matches installed format contracts', () => {
  const engines = [
    () => import('@file-viewer/renderer-word').then((m) => m.wordRenderer),
    () => import('@file-viewer/renderer-spreadsheet').then((m) => m.spreadsheetRenderer),
    () => import('@file-viewer/renderer-ofd').then((m) => m.ofdRenderer),
    () => import('@file-viewer/renderer-email').then((m) => m.emailRenderer),
    () => import('@file-viewer/renderer-mindmap').then((m) => m.mindmapRenderer),
    () => import('@file-viewer/renderer-drawing').then((m) => m.drawingRenderer),
    () => import('@file-viewer/renderer-data').then((m) => m.dataRenderer),
    () => import('@file-viewer/renderer-geo').then((m) => m.geoRenderer),
    () => import('@file-viewer/renderer-text').then((m) => m.textRenderer),
    () => import('@file-viewer/renderer-archive').then((m) => m.archiveRenderer),
    () => import('@file-viewer/renderer-presentation').then((m) => m.presentationRenderer),
  ];
  it.each(engines.map((load, index) => ({ load, index })))('format $index retains all definitions and handlers without install side effects', async ({ load, index }) => {
    const actual = await load();
    const deferred = fileViewerRenderers[index];
    expect(deferred.definitions?.map((entry) => entry.id)).toEqual(actual.definitions?.map((entry) => entry.id));
    expect(deferred.handlers?.map((entry) => entry.rendererId).sort()).toEqual(actual.handlers?.map((entry) => entry.rendererId).sort());
    expect(actual).not.toHaveProperty('install');
  });
});
