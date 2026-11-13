import { describe, expect, it } from 'vitest';
import { filesSettingsSchema } from '@zenith/shared/settings';
import { readFile } from 'node:fs/promises';
import { detectUploadMimeType, blobUploadTypeSource, validateUploadType } from './upload-type';

const FREE = 0xffffffff;
const END = 0xfffffffe;
const FAT = 0xfffffffd;

function directoryEntry(buffer: Buffer, index: number, name: string, type: number, start: number, size: number, child = FREE) {
  const offset = index * 128;
  const nameBytes = Buffer.from(`${name}\0`, 'utf16le');
  nameBytes.copy(buffer, offset);
  buffer.writeUInt16LE(nameBytes.length, offset + 64);
  buffer[offset + 66] = type;
  buffer.writeUInt32LE(FREE, offset + 68);
  buffer.writeUInt32LE(FREE, offset + 72);
  buffer.writeUInt32LE(child, offset + 76);
  buffer.writeUInt32LE(start, offset + 116);
  buffer.writeBigUInt64LE(BigInt(size), offset + 120);
}

/** Minimal v3 CFB container with one legacy Office stream; enough to exercise real magic-byte parsing. */
function legacyOfficeFile(kind: 'doc' | 'xls' | 'ppt' | 'unknown'): Buffer {
  const sectorSize = 512;
  const streamSize = 4096;
  const sectorCount = 10;
  const file = Buffer.alloc(sectorSize * (sectorCount + 1), 0);
  const header = file.subarray(0, sectorSize);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(0, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(END, 60);
  header.writeUInt32LE(0, 64);
  header.writeUInt32LE(END, 68);
  header.writeUInt32LE(0, 72);
  header.writeUInt32LE(1, 76);
  for (let offset = 80; offset < 512; offset += 4) header.writeUInt32LE(FREE, offset);

  const streamName = kind === 'doc' ? 'WordDocument' : kind === 'xls' ? 'Workbook' : kind === 'ppt' ? 'PowerPoint Document' : 'Data';
  const directory = file.subarray(sectorSize, sectorSize * 2);
  directoryEntry(directory, 0, 'Root Entry', 5, END, 0, 1);
  directoryEntry(directory, 1, streamName, 2, 2, streamSize);

  const fat = file.subarray(sectorSize * 2, sectorSize * 3);
  fat.fill(0xff);
  fat.writeUInt32LE(END, 0 * 4);
  fat.writeUInt32LE(FAT, 1 * 4);
  for (let id = 2; id < 9; id++) fat.writeUInt32LE(id + 1, id * 4);
  fat.writeUInt32LE(END, 9 * 4);

  const stream = file.subarray(sectorSize * 3, sectorSize * 11);
  if (kind === 'doc') stream.writeUInt16LE(0xa5ec, 0);
  if (kind === 'xls') stream.writeUInt16LE(0x0809, 0);
  if (kind === 'ppt') stream.writeUInt16LE(0x03e8, 2);
  return file;
}

describe('legacy Office upload type detection', () => {
  const settings = filesSettingsSchema.parse({});

  it.each([
    ['doc', 'application/msword'],
    ['xls', 'application/vnd.ms-excel'],
    ['ppt', 'application/vnd.ms-powerpoint'],
  ] as const)('recognizes %s CFB content as %s', async (kind, mime) => {
    const source = blobUploadTypeSource(new Blob([legacyOfficeFile(kind)]));
    await expect(detectUploadMimeType(source, 'application/octet-stream')).resolves.toBe(mime);
    await expect(validateUploadType(source, 'application/octet-stream', settings)).resolves.toBe(mime);
  });

  it('does not treat an arbitrary CFB container as Office', async () => {
    const source = blobUploadTypeSource(new Blob([legacyOfficeFile('unknown')]));
    await expect(detectUploadMimeType(source, 'application/octet-stream')).resolves.toBe('application/x-cfb');
    await expect(validateUploadType(source, 'application/octet-stream', settings)).rejects.toMatchObject({ status: 400 });
  });

  it('still enforces the configured MIME list after detecting legacy Office', async () => {
    const source = blobUploadTypeSource(new Blob([legacyOfficeFile('doc')]));
    await expect(validateUploadType(source, 'application/octet-stream', { uploadValidateType: true, uploadAllowedTypes: ['application/pdf'] })).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['test.doc', 'application/msword'],
    ['Simple.xls', 'application/vnd.ms-excel'],
    ['basic_test_ppt_file.ppt', 'application/vnd.ms-powerpoint'],
  ])('detects the real Apache POI sample %s even with an incorrect declared type', async (name, mime) => {
    const bytes = await readFile(new URL(`./fixtures/legacy-office/${name}`, import.meta.url));
    const source = blobUploadTypeSource(new File([bytes], 'renamed.pdf', { type: 'application/pdf' }));
    await expect(validateUploadType(source, 'application/pdf', settings)).resolves.toBe(mime);
    await expect(validateUploadType(source, 'application/pdf', { uploadValidateType: true, uploadAllowedTypes: ['application/pdf'] })).rejects.toMatchObject({ status: 400 });
  });

  it('does not trust a Word stream name without the matching stream signature', async () => {
    const bytes = legacyOfficeFile('doc');
    bytes.writeUInt16LE(0, 512 * 3);
    await expect(validateUploadType(blobUploadTypeSource(new Blob([bytes])), 'application/msword', settings)).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sample.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['sample.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ])('preserves OOXML detection for %s', async (name, mime) => {
    const bytes = await readFile(new URL(`./fixtures/legacy-office/${name}`, import.meta.url));
    await expect(validateUploadType(blobUploadTypeSource(new Blob([bytes])), mime, settings)).resolves.toBe(mime);
  });

  it('reads a v4 container with 4096-byte sectors', async () => {
    const v3 = legacyOfficeFile('doc');
    const bytes = Buffer.alloc(4096 * 4);
    v3.subarray(0, 512).copy(bytes);
    bytes.writeUInt16LE(4, 26);
    bytes.writeUInt16LE(12, 30);
    bytes.writeUInt32LE(1, 40);
    v3.subarray(512, 1024).copy(bytes, 4096);
    bytes.fill(0xff, 8192, 12288);
    bytes.writeUInt32LE(END, 8192);
    bytes.writeUInt32LE(FAT, 8192 + 4);
    bytes.writeUInt32LE(END, 8192 + 8);
    bytes.writeUInt16LE(0xa5ec, 12288);
    await expect(validateUploadType(blobUploadTypeSource(new Blob([bytes])), 'application/octet-stream', settings)).resolves.toBe('application/msword');
  });

  it('reads small Office streams from the root mini stream', async () => {
    const bytes = legacyOfficeFile('xls');
    directoryEntry(bytes.subarray(512, 1024), 0, 'Root Entry', 5, 3, 512, 1);
    directoryEntry(bytes.subarray(512, 1024), 1, 'Book', 2, 0, 64);
    bytes.writeUInt32LE(2, 60);
    bytes.writeUInt32LE(1, 64);
    bytes.writeUInt32LE(END, 1024 + 2 * 4);
    bytes.writeUInt32LE(END, 1024 + 3 * 4);
    bytes.fill(0xff, 1536, 2048);
    bytes.writeUInt32LE(END, 1536);
    bytes.writeUInt16LE(0x0809, 2048);
    await expect(validateUploadType(blobUploadTypeSource(new Blob([bytes])), 'application/octet-stream', settings)).resolves.toBe('application/vnd.ms-excel');
  });

  it('does not classify an embedded Word stream as the top-level file type', async () => {
    const bytes = legacyOfficeFile('doc');
    const directory = bytes.subarray(512, 1024);
    directoryEntry(directory, 1, 'EmbeddedObject', 1, END, 0, 2);
    directoryEntry(directory, 2, 'WordDocument', 2, 2, 4096);
    await expect(validateUploadType(blobUploadTypeSource(new Blob([bytes])), 'application/msword', settings)).rejects.toMatchObject({ status: 400 });
  });

  it('does not identify an encrypted OOXML container as legacy Word', async () => {
    const bytes = legacyOfficeFile('doc');
    const directory = bytes.subarray(512, 1024);
    directoryEntry(directory, 1, 'EncryptedPackage', 2, 2, 4096);
    await expect(validateUploadType(blobUploadTypeSource(new Blob([bytes])), 'application/msword', settings)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects ambiguous top-level Office streams', async () => {
    const bytes = legacyOfficeFile('doc');
    const directory = bytes.subarray(512, 1024);
    directory.writeUInt32LE(2, 128 + 72);
    directoryEntry(directory, 2, 'Workbook', 2, 2, 4096);
    await expect(validateUploadType(blobUploadTypeSource(new Blob([bytes])), 'application/msword', settings)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects truncated CFB input instead of trusting its declared Office MIME', async () => {
    const bytes = legacyOfficeFile('doc').subarray(0, 512);
    await expect(validateUploadType(blobUploadTypeSource(new Blob([bytes])), 'application/msword', settings)).rejects.toMatchObject({ status: 400 });
  });

  it('stops cyclic directory chains with a bounded number of reads', async () => {
    const bytes = legacyOfficeFile('doc');
    bytes.writeUInt32LE(0, 512 * 2);
    let reads = 0;
    const source = { size: bytes.length, read: async (offset: number, length: number) => { reads++; return bytes.subarray(offset, offset + length); } };
    await expect(validateUploadType(source, 'application/msword', settings)).rejects.toMatchObject({ status: 400 });
    expect(reads).toBeLessThan(10);
  });

  it('respects explicit CFB permission and the disabled validation switch', async () => {
    const source = blobUploadTypeSource(new Blob([legacyOfficeFile('unknown')]));
    await expect(validateUploadType(source, 'application/msword', { uploadValidateType: true, uploadAllowedTypes: ['application/x-cfb'] })).resolves.toBe('application/x-cfb');
    await expect(validateUploadType({ size: 100, read: async () => { throw new Error('must not read'); } }, 'application/msword', { uploadValidateType: false, uploadAllowedTypes: [] })).resolves.toBe('application/msword');
  });

  it('keeps PDF, plain text and image wildcard validation', async () => {
    for (const [bytes, mime] of [[Buffer.from('%PDF-1.7\n'), 'application/pdf'], [Buffer.from('hello\n'), 'text/plain'], [Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), 'image/png']] as const) {
      await expect(validateUploadType(blobUploadTypeSource(new Blob([bytes])), mime, settings)).resolves.toBe(mime);
    }
  });
});
