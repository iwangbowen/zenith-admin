import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const root = resolve(process.env.ZENITH_BENCH_SERVER_ROOT ?? import.meta.dirname);
  const selected = process.env.ZENITH_BENCH_SELECTION === 'true';
  const { default: config } = await import(pathToFileURL(resolve(root, selected ? 'vitest.selected.config.ts' : 'vitest.config.ts')).href);
  const suite = process.env.ZENITH_BENCH_SUITE ?? 'full';
  const include = selected || suite === 'full' ? config.test.include
    : suite === 'contract' ? ['src/app.contract.test.ts']
      : [`src/routes/${suite}/**/*.test.ts`, `src/services/${suite}/**/*.test.ts`];
  return {
    ...config,
    root,
    test: {
      ...config.test,
      include,
      maxWorkers: 8,
      fsModuleCache: false,
      setupFiles: [...config.test.setupFiles, resolve(import.meta.dirname, 'scripts/testing/benchmark-setup.ts')],
      ...(selected ? { projects: config.test.projects.map((project: { test: { setupFiles: string[] } }) => ({
        ...project, test: { ...project.test, setupFiles: [...project.test.setupFiles, resolve(import.meta.dirname, 'scripts/testing/benchmark-setup.ts')] },
      })) } : {}),
      reporters: ['dot', 'json', resolve(import.meta.dirname, 'scripts/testing/benchmark-reporter.mjs')],
      outputFile: { json: process.env.ZENITH_BENCH_JSON },
    },
  };
});
