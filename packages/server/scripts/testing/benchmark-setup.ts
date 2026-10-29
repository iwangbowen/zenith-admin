import { afterAll, vi } from 'vitest';

const filename = process.env.ZENITH_BENCH_RESOURCES;
if (filename) {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
  const pid = process.pid;
  afterAll(() => {
    fs.appendFileSync(filename, `${JSON.stringify({ role: 'worker', pid, ...process.resourceUsage() })}\n`);
  });
}
