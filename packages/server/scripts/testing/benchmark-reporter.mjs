import { appendFileSync } from 'node:fs';

export default class BenchmarkReporter {
  onTestRunEnd() {
    const filename = process.env.ZENITH_BENCH_RESOURCES;
    if (filename) appendFileSync(filename, `${JSON.stringify({ role: 'coordinator', pid: process.pid, ...process.resourceUsage() })}\n`);
  }
}
