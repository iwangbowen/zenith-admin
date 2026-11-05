import { constants, type Stats } from 'node:fs';
import fsp, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import type { QueryOutputOf } from '@zenith/shared/core';
import {
  CONSOLE_LOG_ROLES,
  matchesLogCorrelationId,
  LOG_CORRELATION_LOCATOR_MAX_BYTES,
  LOG_CORRELATION_LOCATOR_MAX_CONTEXT_LINES,
  LOG_CORRELATION_LOCATOR_MAX_FILES,
  LOG_CORRELATION_LOCATOR_MAX_LINE_LENGTH,
  LOG_CORRELATION_LOCATOR_MAX_MATCHES,
  type ConsoleLogRole,
  type logLocatorContract,
  type LogLocatorMatch,
  type LogLocatorResult,
  type LogLocatorSource,
} from '@zenith/shared/ops';
import { config } from '../../config';
import { PROCESS_HOSTNAME } from '../../lib/process-identity';

const FILE_PATTERN = /^app(?:-(api|worker))?\.(\d{4}-\d{2}-\d{2})\.([1-9]\d{0,14})\.log(?:\.gz)?$/;
const READ_CHUNK_BYTES = 64 * 1024;

type LocatorQuery = QueryOutputOf<typeof logLocatorContract.locate>;

interface LocatorFile {
  name: string;
  role: ConsoleLogRole;
  date: string;
  sequence: number;
  isGzip: boolean;
}

interface OpenedFile {
  handle: FileHandle;
  stat: Stats;
}

interface FirstMatch {
  hostname: string;
  pid: number | null;
  lines: string[];
  remainingAfter: number;
}

interface ScanResult {
  matchCount: number;
  firstMatch: FirstMatch | undefined;
  truncated: boolean;
}

interface OpenSnapshotFailure {
  kind: 'unavailable' | 'error';
  reason: string;
}

type OpenSnapshotResult =
  | { opened: OpenedFile }
  | { failure: OpenSnapshotFailure };

class LogLineTooLongError extends Error {}

function logDirectory(): string {
  return path.resolve(config.log.dir);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

function fileIdentity(stat: Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
}

function parseFilename(name: string): LocatorFile | undefined {
  const match = FILE_PATTERN.exec(name);
  if (!match) return undefined;
  return {
    name,
    role: (match[1] ?? 'all') as ConsoleLogRole,
    date: match[2],
    sequence: Number(match[3]),
    isGzip: name.endsWith('.gz'),
  };
}

function compareNewest(a: LocatorFile, b: LocatorFile): number {
  return b.date.localeCompare(a.date) || b.sequence - a.sequence || a.name.localeCompare(b.name);
}

async function discoverFiles(): Promise<LocatorFile[]> {
  const entries = await fsp.readdir(logDirectory(), { withFileTypes: true });
  return entries.flatMap((entry) => {
    // Symlinks are deliberately excluded. The locator only scans regular files
    // enumerated directly inside LOG_DIR, just like the console log reader.
    const file = entry.isFile() ? parseFilename(entry.name) : undefined;
    return file ? [file] : [];
  }).sort(compareNewest);
}

async function openSnapshot(file: LocatorFile): Promise<OpenSnapshotResult> {
  const filepath = path.join(logDirectory(), file.name);
  let handle: FileHandle | undefined;
  try {
    const before = await fsp.lstat(filepath);
    if (!before.isFile()) return { failure: { kind: 'unavailable', reason: 'file_unavailable' } };
    handle = await fsp.open(filepath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || fileIdentity(before) !== fileIdentity(stat)) {
      await handle.close();
      return { failure: { kind: 'unavailable', reason: 'file_changed' } };
    }
    return { opened: { handle, stat } };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (isMissing(error)) return { failure: { kind: 'unavailable', reason: 'file_unavailable' } };
    return { failure: { kind: 'error', reason: 'file_open_error' } };
  }
}

/** Read a fixed file descriptor snapshot, optionally through gzip, without following a replacement path. */
async function* readLines(handle: FileHandle, isGzip: boolean, size: number): AsyncGenerator<string> {
  if (size <= 0) return;
  const source = handle.createReadStream({
    autoClose: false,
    highWaterMark: READ_CHUNK_BYTES,
    start: 0,
    end: size - 1,
  });
  const input = isGzip ? source.pipe(zlib.createGunzip()) : source;
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of input as AsyncIterable<Buffer | string>) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const joined = pending.length > 0 ? Buffer.concat([pending, bytes]) : bytes;
      let start = 0;
      for (let end = joined.indexOf(10); end !== -1; end = joined.indexOf(10, start)) {
        if (end - start > LOG_CORRELATION_LOCATOR_MAX_LINE_LENGTH) {
          throw new LogLineTooLongError();
        }
        yield joined.subarray(start, end).toString('utf8').replace(/\r$/, '');
        start = end + 1;
      }
      pending = Buffer.from(joined.subarray(start));
      if (pending.length > LOG_CORRELATION_LOCATOR_MAX_LINE_LENGTH) {
        throw new LogLineTooLongError();
      }
    }
    if (pending.length > 0) yield pending.toString('utf8').replace(/\r$/, '');
  } finally {
    input.destroy();
    if (input !== source) source.destroy();
  }
}

function matchingEntry(line: string, correlationId: string): { hostname: string; pid: number | null } | undefined {
  if (!matchesLogCorrelationId(line, correlationId)) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null) return undefined;
    const hostname = 'hostname' in value && typeof value.hostname === 'string' && value.hostname.length > 0
      ? value.hostname
      : PROCESS_HOSTNAME;
    const pid = 'pid' in value && typeof value.pid === 'number' && Number.isSafeInteger(value.pid)
      ? value.pid
      : null;
    return { hostname, pid };
  } catch {
    return undefined;
  }
}

function safeScanError(error: unknown, isGzip: boolean): string {
  if (error instanceof LogLineTooLongError) return 'line_too_long';
  const code = errorCode(error);
  if (isGzip && code?.startsWith('Z_')) return 'invalid_gzip';
  return 'read_error';
}

async function scanFile(
  file: LocatorFile,
  correlationId: string,
  context: number,
  matchLineBudget: number,
  byteBudget: number,
): Promise<{
  result?: ScanResult;
  opened: boolean;
  bytes: number;
  error?: string;
  failureKind?: OpenSnapshotFailure['kind'];
  overBudget?: boolean;
}> {
  const snapshot = await openSnapshot(file);
  if ('failure' in snapshot) {
    return {
      opened: false,
      bytes: 0,
      error: snapshot.failure.reason,
      failureKind: snapshot.failure.kind,
    };
  }
  const { handle, stat } = snapshot.opened;
  if (stat.size > byteBudget) {
    await handle.close().catch(() => {});
    return { opened: true, bytes: 0, overBudget: true };
  }
  const result: ScanResult = { matchCount: 0, firstMatch: undefined, truncated: false };
  try {
    const before: string[] = [];
    for await (const line of readLines(handle, file.isGzip, stat.size)) {
      if (line.trim() === '') continue;
      const match = matchingEntry(line, correlationId);
      if (result.firstMatch && result.firstMatch.remainingAfter > 0) {
        result.firstMatch.lines.push(line);
        result.firstMatch.remainingAfter -= 1;
      }
      if (match) {
        result.matchCount += 1;
        if (!result.firstMatch) {
          result.firstMatch = {
            hostname: match.hostname,
            pid: match.pid,
            lines: [...before, line],
            remainingAfter: context,
          };
        }
        if (result.matchCount >= matchLineBudget) {
          result.truncated = true;
          break;
        }
      }
      before.push(line);
      if (before.length > context) before.shift();
    }
    return { result, opened: true, bytes: stat.size };
  } catch (error) {
    return {
      result,
      opened: true,
      bytes: stat.size,
      error: safeScanError(error, file.isGzip),
    };
  } finally {
    await handle.close().catch(() => {});
  }
}

function createSource(role: ConsoleLogRole): LogLocatorSource {
  return {
    role,
    hostname: null,
    status: 'unavailable',
    scannedFiles: 0,
    scannedBytes: 0,
    error: null,
  };
}

function sourceFor(sources: Map<ConsoleLogRole, LogLocatorSource>, role: ConsoleLogRole): LogLocatorSource {
  const source = sources.get(role);
  if (!source) throw new Error(`missing source ${role}`);
  return source;
}

function markSourceError(source: LogLocatorSource, error: string): void {
  source.status = 'error';
  source.error ??= error;
}

function statusOf(
  matches: readonly LogLocatorMatch[],
  sources: readonly LogLocatorSource[],
  truncated: boolean,
): LogLocatorResult['status'] {
  if (matches.length > 0) return 'matched';
  if (truncated || sources.some((source) => source.status === 'error')) return 'source_error';
  if (sources.some((source) => source.status === 'scanned')) return 'not_found';
  return 'source_unavailable';
}

export async function locateCorrelationLogs(query: LocatorQuery): Promise<LogLocatorResult> {
  const context = Math.min(query.context ?? 2, LOG_CORRELATION_LOCATOR_MAX_CONTEXT_LINES);
  const sources = new Map<ConsoleLogRole, LogLocatorSource>(CONSOLE_LOG_ROLES.map((role) => [role, createSource(role)]));
  const matches: LogLocatorMatch[] = [];
  let scannedFiles = 0;
  let examinedFiles = 0;
  let scannedBytes = 0;
  let truncated = false;
  let files: LocatorFile[];

  try {
    files = await discoverFiles();
  } catch (error) {
    const reason = isMissing(error) ? 'log_directory_missing' : 'log_directory_unavailable';
    for (const source of sources.values()) {
      source.status = isMissing(error) ? 'unavailable' : 'error';
      source.error = reason;
    }
    return {
      correlationId: query.correlationId,
      status: isMissing(error) ? 'source_unavailable' : 'source_error',
      matches,
      sources: [...sources.values()],
      scannedFiles,
      scannedBytes,
      truncated: false,
    };
  }

  for (const file of files) {
    if (examinedFiles >= LOG_CORRELATION_LOCATOR_MAX_FILES || matches.length >= LOG_CORRELATION_LOCATOR_MAX_MATCHES) {
      truncated = true;
      break;
    }
    examinedFiles += 1;
    const source = sourceFor(sources, file.role);
    source.hostname ??= PROCESS_HOSTNAME;
    const remainingMatchBudget = LOG_CORRELATION_LOCATOR_MAX_MATCHES - matches.length;
    const remainingByteBudget = LOG_CORRELATION_LOCATOR_MAX_BYTES - scannedBytes;
    const scanned = await scanFile(file, query.correlationId, context, remainingMatchBudget, remainingByteBudget);
    if (!scanned.opened) {
      markSourceError(source, scanned.error ?? 'file_unavailable');
      continue;
    }
    if (scanned.overBudget) {
      truncated = true;
      continue;
    }
    scannedFiles += 1;
    scannedBytes += scanned.bytes;
    if (source.status === 'unavailable') source.status = 'scanned';
    source.scannedFiles += 1;
    source.scannedBytes += scanned.bytes;
    if (scanned.error) {
      markSourceError(source, scanned.error);
    }
    if (scanned.result?.firstMatch) {
      const first = scanned.result.firstMatch;
      matches.push({
        role: file.role,
        hostname: first.hostname,
        pid: first.pid,
        filename: file.name,
        date: file.date,
        sequence: file.sequence,
        isGzip: file.isGzip,
        matchedField: 'correlationId',
        matchCount: scanned.result.matchCount,
        context: first.lines,
      });
    }
    if (scanned.result?.truncated) {
      truncated = true;
      break;
    }
  }

  return {
    correlationId: query.correlationId,
    status: statusOf(matches, [...sources.values()], truncated),
    matches,
    sources: [...sources.values()],
    scannedFiles,
    scannedBytes,
    truncated,
  };
}
