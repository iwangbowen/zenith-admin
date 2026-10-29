#!/usr/bin/env node
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { serverRoot, workspaceRoot, buildFileGraph, planDomainTests } from './test-graph.mjs';
import { vitestBin, withTestPlan } from './test-runner.mjs';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--suite', '--label', '--server-root', '--repeat', '--out', '--source-ref'].includes(args[i]) || !args[i + 1]) throw new Error(`Invalid option: ${args[i]}`);
  options[args[i].slice(2)] = args[i + 1];
}
const suites = (options.suite ?? 'full').split(',');
const repetitions = Number(options.repeat ?? 1);
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('--repeat must be a positive integer');
const target = resolve(workspaceRoot, options['server-root'] ?? serverRoot);
const output = resolve(workspaceRoot, options.out ?? '.tmp/server-test-benchmarks');
const pdfFont = join(target, 'assets/fonts/NotoSansSC-Regular.otf');
if (!existsSync(pdfFont)) throw new Error('Benchmark requires the repository full PDF font');
const label = options.label ?? 'current';
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('--label must contain only letters, numbers, underscores or hyphens');
mkdirSync(output, { recursive: true });
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf8' }).trim();
const manifest = { node: process.version, platform: process.platform, arch: process.arch,
  cpus: cpus().length, memoryGiB: totalmem() / 1024 ** 3, maxWorkers: 8, pool: 'forks', isolate: true,
  lockHash: createHash('sha256').update(readFileSync(join(workspaceRoot, 'package-lock.json'))).digest('hex'),
  runnerCommit: sha, sourceCommit: options['source-ref'] ?? (target === serverRoot ? sha : null),
  fsModuleCache: false, dotenv: 'disabled for benchmark',
  pdfFontSha256: createHash('sha256').update(readFileSync(pdfFont)).digest('hex'),
  target, label, startedAt: new Date().toISOString(), samples: [] };
for (const suite of suites) {
  if (!/^[a-z-]+$/.test(suite)) throw new Error(`Invalid suite: ${suite}`);
  for (let i = 0; i < repetitions; i++) {
    const stem = join(output, `${label}-${suite}-${i + 1}`);
    const jsonFile = `${stem}.json`;
    const resourcesFile = `${stem}.resources.jsonl`;
    if (existsSync(jsonFile) || existsSync(resourcesFile)) throw new Error(`Refusing to overwrite benchmark sample: ${stem}`);
    const fd = openSync(`${stem}.log`, 'w');
    const start = performance.now();
    console.log(`Benchmark ${label}/${suite} ${i + 1}/${repetitions}`);
    const domain = suite.startsWith('domain-') ? suite.slice('domain-'.length) : null;
    if (domain && target !== serverRoot) throw new Error('Domain profiles require the current domain test infrastructure');
    const execute = (planFile) => spawnSync(process.execPath, [vitestBin, 'run', '--config', join(serverRoot, 'vitest.benchmark.config.ts')], {
      cwd: target, stdio: ['ignore', fd, fd], env: { ...process.env, ZENITH_BENCH_SERVER_ROOT: target,
        DOTENV_CONFIG_PATH: join(output, '__benchmark_no_dotenv__.env'),
        REPORT_PDF_FONT_PATH: pdfFont,
        ...(planFile ? { ZENITH_TEST_PLAN: planFile, ZENITH_BENCH_SELECTION: 'true' } : {}),
        ZENITH_BENCH_SUITE: suite, ZENITH_BENCH_JSON: jsonFile, ZENITH_BENCH_RESOURCES: resourcesFile },
    });
    const run = domain ? withTestPlan(planDomainTests([domain], buildFileGraph()), execute) : execute();
    closeSync(fd);
    const wallSeconds = (performance.now() - start) / 1000;
    const result = existsSync(jsonFile) ? JSON.parse(readFileSync(jsonFile, 'utf8')) : {};
    const records = existsSync(resourcesFile) ? readFileSync(resourcesFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
    const processes = new Map();
    for (const record of records) {
      const previous = processes.get(record.pid);
      if (!previous || previous.userCPUTime + previous.systemCPUTime < record.userCPUTime + record.systemCPUTime) processes.set(record.pid, record);
    }
    const sample = {
      suite, wallSeconds, exitCode: run.status, success: result.success ?? false,
      passed: result.numPassedTests, failed: result.numFailedTests, skipped: result.numPendingTests,
      fileCount: result.testResults?.length, files: result.testResults?.map((test) => test.name.replaceAll('\\', '/').replace(`${target.replaceAll('\\', '/')}/`, '')).sort(),
      measuredProcesses: processes.size,
      coordinatorAndTestWorkerCpuSeconds: [...processes.values()].reduce((sum, record) => sum + record.userCPUTime + record.systemCPUTime, 0) / 1_000_000,
      largestMeasuredProcessPeakRssMiB: Math.max(0, ...[...processes.values()].map((record) => record.maxRSS / 1024)),
      log: `${stem}.log`, json: jsonFile, resources: resourcesFile,
    };
    manifest.samples.push(sample);
    writeFileSync(join(output, `${label}-summary.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ ...sample, files: undefined }));
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
