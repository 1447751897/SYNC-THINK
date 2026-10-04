/** Small, dependency-free ZIP STORE writer for fixed OfficeXML package entries. */
export interface OfficeZipEntry {
  readonly name: string;
  readonly data: string | Buffer;
}
export class OfficeZipError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OfficeZipError';
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function officeZipCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function createOfficeZip(entries: readonly OfficeZipEntry[], maxBytes: number): Buffer {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 22 ||
    maxBytes > 0xffffffff ||
    entries.length === 0 ||
    entries.length > 512
  )
    throw new OfficeZipError('artifact.zip_limit', 'ZIP 包大小或条目数无效。');
  const names = new Set<string>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const entry of entries) {
    if (
      !entry.name ||
      entry.name.length > 240 ||
      entry.name.startsWith('/') ||
      /[^A-Za-z0-9_[\]./-]/.test(entry.name) ||
      entry.name.split('/').some((part) => !part || part === '.' || part === '..') ||
      entry.name.includes('..') ||
      names.has(entry.name)
    )
      throw new OfficeZipError(
        'artifact.zip_entry_invalid',
        'ZIP entry 须为唯一、包内的固定相对路径。',
      );
    names.add(entry.name);
    const name = Buffer.from(entry.name, 'utf8');
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    if (data.length > 0xffffffff)
      throw new OfficeZipError('artifact.output_too_large', '产物超过 ZIP 长度上限。');
    const localSize = 30 + name.length + data.length;
    const centralEntrySize = 46 + name.length;
    if (offset + localSize + centralSize + centralEntrySize + 22 > maxBytes)
      throw new OfficeZipError('artifact.output_too_large', '产物超过输出字节配额。');
    const crc = officeZipCrc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, data);
    centralParts.push(central, name);
    offset += localSize;
    centralSize += centralEntrySize;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end], offset + centralSize + 22);
}
