import { HTTPException } from 'hono/http-exception';
import type { FilesSettings } from '@zenith/shared/settings';

/** Random access keeps Office detection independent of file size and multipart boundaries. */
export interface UploadTypeSource {
  size: number;
  read: (offset: number, length: number) => Promise<Buffer>;
}

export function blobUploadTypeSource(blob: Blob): UploadTypeSource {
  return { size: blob.size, read: async (offset, length) => Buffer.from(await blob.slice(offset, offset + length).arrayBuffer()) };
}

const CFB_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const CFB_MIME = 'application/x-cfb';
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
// These are parser resource limits, not upload size limits. Only metadata and stream signatures are read.
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_CHAIN_SECTORS = 4096;

export function isCompoundFile(head: Uint8Array): boolean {
  return head.length >= CFB_SIGNATURE.length && CFB_SIGNATURE.equals(head.subarray(0, CFB_SIGNATURE.length));
}

class InvalidCompoundFile extends Error {}
function requireCompound(condition: boolean): asserts condition {
  if (!condition) throw new InvalidCompoundFile('Invalid or unsupported compound file');
}

interface DirectoryEntry {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

/** MS-CFB: follow DIFAT/FAT and the root directory; embedded documents are not top-level formats. */
async function detectCompoundOfficeMime(source: UploadTypeSource): Promise<string | undefined> {
  let readBytes = 0;
  const read = async (offset: number, length: number) => {
    requireCompound(Number.isSafeInteger(offset) && offset >= 0 && offset + length <= source.size);
    readBytes += length;
    requireCompound(readBytes <= MAX_METADATA_BYTES);
    const bytes = await source.read(offset, length);
    requireCompound(bytes.length === length);
    return bytes;
  };
  const header = await read(0, 512);
  const version = header.readUInt16LE(26);
  const shift = header.readUInt16LE(30);
  requireCompound(header.readUInt16LE(28) === 0xfffe && ((version === 3 && shift === 9) || (version === 4 && shift === 12)));
  requireCompound(header.readUInt16LE(32) === 6 && header.readUInt32LE(56) === 4096);
  const sectorSize = 2 ** shift;
  const sectorCount = Math.floor(source.size / sectorSize) - 1;
  const validSector = (id: number) => id >= 0 && id < sectorCount;
  const sector = async (id: number) => {
    requireCompound(validSector(id));
    return read((id + 1) * sectorSize, sectorSize);
  };
  const fatCount = header.readUInt32LE(44);
  requireCompound(fatCount > 0 && fatCount <= sectorCount);
  const fatIds: number[] = [];
  const addFat = (id: number) => {
    if (id === FREE_SECTOR) return;
    requireCompound(validSector(id) && fatIds.length < fatCount);
    fatIds.push(id);
  };
  for (let offset = 76; offset < 512; offset += 4) addFat(header.readUInt32LE(offset));
  let difatId = header.readUInt32LE(68);
  const difatCount = header.readUInt32LE(72);
  requireCompound(difatCount <= sectorCount && difatCount <= MAX_CHAIN_SECTORS);
  const difatSeen = new Set<number>();
  for (let index = 0; index < difatCount; index++) {
    requireCompound(!difatSeen.has(difatId));
    difatSeen.add(difatId);
    const block = await sector(difatId);
    for (let offset = 0; offset < sectorSize - 4; offset += 4) addFat(block.readUInt32LE(offset));
    difatId = block.readUInt32LE(sectorSize - 4);
  }
  requireCompound(fatIds.length === fatCount && new Set(fatIds).size === fatCount);
  const fatBlocks = new Map<number, Buffer>();
  const nextSector = async (id: number) => {
    requireCompound(validSector(id));
    const fatIndex = Math.floor(id / (sectorSize / 4));
    requireCompound(fatIndex < fatIds.length);
    let block = fatBlocks.get(fatIndex);
    if (!block) {
      block = await sector(fatIds[fatIndex]);
      fatBlocks.set(fatIndex, block);
    }
    return block.readUInt32LE((id % (sectorSize / 4)) * 4);
  };
  const chainSector = async (start: number, index: number) => {
    requireCompound(index < MAX_CHAIN_SECTORS);
    let id = start;
    const seen = new Set<number>();
    for (let step = 0; step <= index; step++) {
      requireCompound(validSector(id) && !seen.has(id));
      seen.add(id);
      if (step === index) return sector(id);
      id = await nextSector(id);
    }
    throw new InvalidCompoundFile();
  };
  const directoryBlocks: Buffer[] = [];
  const directorySeen = new Set<number>();
  let directoryId = header.readUInt32LE(48);
  while (directoryId !== END_OF_CHAIN) {
    requireCompound(directorySeen.size < MAX_CHAIN_SECTORS && !directorySeen.has(directoryId));
    directorySeen.add(directoryId);
    directoryBlocks.push(await sector(directoryId));
    directoryId = await nextSector(directoryId);
  }
  const directory = Buffer.concat(directoryBlocks);
  const entry = (id: number): DirectoryEntry => {
    requireCompound(id < directory.length / 128);
    const offset = id * 128;
    const nameLength = directory.readUInt16LE(offset + 64);
    requireCompound(nameLength >= 2 && nameLength <= 64 && nameLength % 2 === 0);
    requireCompound(directory.readUInt16LE(offset + nameLength - 2) === 0);
    const size = Number(directory.readBigUInt64LE(offset + 120));
    requireCompound(Number.isSafeInteger(size) && size <= source.size);
    return {
      name: directory.toString('utf16le', offset, offset + nameLength - 2),
      type: directory[offset + 66], left: directory.readUInt32LE(offset + 68), right: directory.readUInt32LE(offset + 72),
      child: directory.readUInt32LE(offset + 76), start: directory.readUInt32LE(offset + 116), size,
    };
  };
  const root = entry(0);
  requireCompound(root.type === 5);
  const streams = new Map<string, DirectoryEntry>();
  const pending = [root.child];
  const siblingsSeen = new Set<number>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === FREE_SECTOR) continue;
    requireCompound(id > 0 && !siblingsSeen.has(id));
    siblingsSeen.add(id);
    const node = entry(id);
    requireCompound(node.type === 1 || node.type === 2);
    pending.push(node.left, node.right);
    if (node.type === 2) {
      requireCompound(!streams.has(node.name));
      streams.set(node.name, node);
    }
  }
  // Encrypted OOXML also uses CFB; it must not be mistaken for legacy Office.
  if (streams.has('EncryptedPackage') || streams.has('EncryptionInfo')) return undefined;
  const candidates = [
    ['WordDocument', 'application/msword'],
    ['Workbook', 'application/vnd.ms-excel'],
    ['Book', 'application/vnd.ms-excel'],
    ['PowerPoint Document', 'application/vnd.ms-powerpoint'],
  ].filter(([name]) => streams.has(name));
  if (candidates.length !== 1) return undefined;
  const [name, mime] = candidates[0];
  const main = streams.get(name)!;
  requireCompound(main.size >= 8);
  let signature: Buffer;
  if (main.size >= 4096) {
    signature = (await sector(main.start)).subarray(0, 8);
  } else {
    // Small streams live in the root mini stream, addressed through MiniFAT (64-byte sectors).
    requireCompound(main.start < Math.ceil(root.size / 64));
    const miniFatIndex = Math.floor(main.start / (sectorSize / 4));
    requireCompound(miniFatIndex < header.readUInt32LE(64));
    const miniFat = await chainSector(header.readUInt32LE(60), miniFatIndex);
    const nextMini = miniFat.readUInt32LE((main.start % (sectorSize / 4)) * 4);
    requireCompound(nextMini === END_OF_CHAIN || nextMini < Math.ceil(root.size / 64));
    const offset = main.start * 64;
    requireCompound(offset + 8 <= root.size);
    const block = await chainSector(root.start, Math.floor(offset / sectorSize));
    signature = block.subarray(offset % sectorSize, offset % sectorSize + 8);
  }
  if (mime === 'application/msword') return signature.readUInt16LE(0) === 0xa5ec ? mime : undefined;
  if (mime === 'application/vnd.ms-excel') {
    return [0x0009, 0x0209, 0x0409, 0x0809].includes(signature.readUInt16LE(0)) ? mime : undefined;
  }
  // The binary PowerPoint document stream starts with a DocumentContainer record (RT_Document).
  return signature.readUInt16LE(2) === 0x03e8 ? mime : undefined;
}

export async function detectUploadMimeType(source: UploadTypeSource, fallbackMime: string): Promise<string> {
  const head = await source.read(0, Math.min(source.size, 4100));
  if (isCompoundFile(head)) {
    try {
      return await detectCompoundOfficeMime(source) ?? CFB_MIME;
    } catch (error) {
      if (error instanceof InvalidCompoundFile) return CFB_MIME;
      throw error;
    }
  }
  const { fileTypeFromBuffer } = await import('file-type');
  return (await fileTypeFromBuffer(head))?.mime ?? fallbackMime;
}

export async function validateUploadType(source: UploadTypeSource, fallbackMime: string, settings: Pick<FilesSettings, 'uploadValidateType' | 'uploadAllowedTypes'>): Promise<string> {
  if (!settings.uploadValidateType) return fallbackMime;
  const actualMime = await detectUploadMimeType(source, fallbackMime);
  const allowed = settings.uploadAllowedTypes.some((value) => {
    const pattern = value.trim().toLowerCase();
    return pattern === '*' || pattern === '*/*' || (pattern.endsWith('/*') ? actualMime.toLowerCase().startsWith(pattern.slice(0, -1)) : actualMime.toLowerCase() === pattern);
  });
  if (!allowed) throw new HTTPException(400, { message: `文件类型不允许：检测到 ${actualMime}，不在允许类型列表中` });
  return actualMime;
}
