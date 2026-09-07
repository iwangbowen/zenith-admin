import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { parseClamAvVerdict, scanWithClamAv } from './clamav';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function daemon(reply: string, received: Buffer[], respond = true) {
  const server = createServer((socket) => {
    let input = Buffer.alloc(0);
    let commandRead = false;
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      input = Buffer.concat([input, chunk]);
      if (!commandRead) {
        if (input.length < 10) return;
        expect(input.subarray(0, 10).toString()).toBe('zINSTREAM\0');
        input = input.subarray(10);
        commandRead = true;
      }
      while (input.length >= 4) {
        const length = input.readUInt32BE();
        if (input.length < length + 4) return;
        if (length === 0) {
          if (respond) socket.end(reply);
          return;
        }
        received.push(input.subarray(4, length + 4));
        input = input.subarray(length + 4);
      }
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test daemon address');
  return { host: '127.0.0.1', port: address.port, timeoutMs: 1000, maxBytes: 1024 };
}

describe('ClamAV INSTREAM adapter', () => {
  it('frames streamed bytes and accepts an explicit clean verdict', async () => {
    const received: Buffer[] = [];
    const options = await daemon('stream: OK\0', received);
    expect(await scanWithClamAv(Readable.from([Buffer.from('first'), Buffer.from('second')]), options))
      .toEqual({ status: 'clean' });
    expect(Buffer.concat(received).toString()).toBe('firstsecond');
  });

  it('returns the infection signature without treating a scan as successful', async () => {
    const options = await daemon('stream: Test.Signature FOUND\0', []);
    expect(await scanWithClamAv(Readable.from([Buffer.from('sample')]), options))
      .toEqual({ status: 'infected', signature: 'Test.Signature' });
  });

  it('rejects daemon errors and unexpected replies', () => {
    expect(() => parseClamAvVerdict('stream: size limit exceeded ERROR')).toThrow('scan failed');
    expect(() => parseClamAvVerdict('OK')).toThrow('scan failed');
    expect(() => parseClamAvVerdict('')).toThrow('empty response');
  });

  it('rejects oversized input and closes the source', async () => {
    const options = await daemon('stream: OK\0', []);
    const source = Readable.from([Buffer.alloc(50)]);
    await expect(scanWithClamAv(source, { ...options, maxBytes: 10 })).rejects.toThrow('scan limit');
    expect(source.destroyed).toBe(true);
  });

  it('rejects a daemon that never returns a verdict', async () => {
    const options = await daemon('', [], false);
    const source = Readable.from([Buffer.from('sample')]);
    await expect(scanWithClamAv(source, { ...options, timeoutMs: 50 })).rejects.toThrow();
    expect(source.destroyed).toBe(true);
  });

  it('rejects incomplete responses', async () => {
    const options = await daemon('stream:', []);
    await expect(scanWithClamAv(Readable.from([Buffer.from('sample')]), options))
      .rejects.toThrow('complete response');
  });
});
