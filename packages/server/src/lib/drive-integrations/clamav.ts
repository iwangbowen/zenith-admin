import { once } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ClamAvOptions {
  host: string;
  port: number;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
}

export type ClamAvVerdict =
  | { status: 'clean' }
  | { status: 'infected'; signature: string };

export function parseClamAvVerdict(reply: string): ClamAvVerdict {
  const text = reply.replace(/\0$/, '').trim();
  if (text === 'stream: OK') return { status: 'clean' };
  const infected = /^stream: (.+) FOUND$/.exec(text);
  if (infected) return { status: 'infected', signature: infected[1] };
  throw new Error(`ClamAV scan failed: ${text.slice(0, 512) || 'empty response'}`);
}

function readReply(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      socket.off('data', data);
      socket.off('error', error);
      socket.off('end', end);
    };
    const error = (cause: Error) => { cleanup(); reject(cause); };
    const end = () => error(new Error('ClamAV closed without a complete response'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8192) { error(new Error('ClamAV response exceeds the size limit')); return; }
      chunks.push(chunk);
      const reply = Buffer.concat(chunks);
      const terminator = reply.indexOf(0);
      if (terminator < 0) return;
      cleanup();
      resolve(reply.subarray(0, terminator).toString('utf8'));
    };
    socket.on('data', data);
    socket.once('error', error);
    socket.once('end', end);
  });
}

/** Owns and closes source; daemon errors and timeouts never produce a clean verdict. */
export async function scanWithClamAv(source: Readable, options: ClamAvOptions): Promise<ClamAvVerdict> {
  if (!options.host.trim() || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535
    || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1
    || !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    source.destroy();
    throw new Error('Invalid ClamAV connection or scan limits');
  }
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  const socket = createConnection({ host: options.host, port: options.port, signal });
  let bytes = 0;
  const frames = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      if (bytes > options.maxBytes) { done(new Error('File exceeds the configured ClamAV scan limit')); return; }
      const length = Buffer.alloc(4);
      length.writeUInt32BE(chunk.length);
      this.push(length);
      this.push(chunk);
      done();
    },
    flush(done) { this.push(Buffer.alloc(4)); done(); },
  });
  try {
    await once(socket, 'connect', { signal });
    socket.write('zINSTREAM\0');
    const [reply] = await Promise.all([
      readReply(socket),
      pipeline(source, frames, socket, { end: false, signal }),
    ]);
    return parseClamAvVerdict(reply);
  } finally {
    source.destroy();
    frames.destroy();
    socket.destroy();
  }
}
