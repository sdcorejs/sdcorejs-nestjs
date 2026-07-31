import { TextDecoder } from 'node:util';

export const OOXML_MIME_MAIN_PART = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/document.xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xl/workbook.xml',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt/presentation.xml',
} as const;

export const OOXML_MAX_ENTRIES = 2_048;
export const OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const OOXML_MAX_COMPRESSION_RATIO = 100;

type OoxmlMime = keyof typeof OOXML_MIME_MAIN_PART;

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_UINT16 = 0xffff;
const ZIP64_UINT32 = 0xffffffff;
const END_RECORD_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const ENCRYPTION_FLAGS = 0x2041;
const UTF8_NAME_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;

function readUInt16(buffer: Buffer, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 > buffer.byteLength) throw new Error('Invalid ZIP offset');
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > buffer.byteLength) throw new Error('Invalid ZIP offset');
  return buffer.readUInt32LE(offset);
}

function addWithinLimit(left: number, right: number, limit: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < left || total > limit) throw new Error('Invalid ZIP bounds');
  return total;
}

function findEndRecord(buffer: Buffer): number {
  const firstCandidate = Math.max(0, buffer.byteLength - END_RECORD_BYTES - MAX_ZIP_COMMENT_BYTES);
  for (let offset = buffer.byteLength - END_RECORD_BYTES; offset >= firstCandidate; offset -= 1) {
    if (readUInt32(buffer, offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = readUInt16(buffer, offset + 20);
    if (offset + END_RECORD_BYTES + commentLength === buffer.byteLength) return offset;
  }
  throw new Error('ZIP end record not found');
}

function decodeEntryName(bytes: Buffer, flags: number): string {
  if (bytes.byteLength === 0) throw new Error('ZIP entry name is empty');
  let value: string;
  if ((flags & UTF8_NAME_FLAG) !== 0) {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } else {
    if (bytes.some((byte) => byte < 0x20 || byte > 0x7e)) throw new Error('ZIP entry name is not safe ASCII');
    value = bytes.toString('ascii');
  }
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error('ZIP entry path is unsafe');
  }
  return value;
}

function canonicalEntryName(value: string): string {
  const directory = value.endsWith('/');
  const parts = value.split('/');
  if (directory) parts.pop();
  if (parts.length === 0 || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('ZIP entry path is unsafe');
  }
  return `${parts.join('/')}${directory ? '/' : ''}`;
}

/**
 * Performs bounded structural inspection of an OOXML ZIP container.
 *
 * This intentionally does not decompress payloads and is not malware scanning.
 */
export function validateOoxmlContainer(buffer: Buffer, mime: OoxmlMime): boolean {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.byteLength < END_RECORD_BYTES || !(mime in OOXML_MIME_MAIN_PART)) return false;

    const endOffset = findEndRecord(buffer);
    const diskNumber = readUInt16(buffer, endOffset + 4);
    const centralDirectoryDisk = readUInt16(buffer, endOffset + 6);
    const entriesOnDisk = readUInt16(buffer, endOffset + 8);
    const totalEntries = readUInt16(buffer, endOffset + 10);
    const centralDirectorySize = readUInt32(buffer, endOffset + 12);
    const centralDirectoryOffset = readUInt32(buffer, endOffset + 16);

    if (
      diskNumber !== 0 ||
      centralDirectoryDisk !== 0 ||
      entriesOnDisk !== totalEntries ||
      entriesOnDisk === ZIP64_UINT16 ||
      totalEntries === ZIP64_UINT16 ||
      centralDirectorySize === ZIP64_UINT32 ||
      centralDirectoryOffset === ZIP64_UINT32 ||
      totalEntries > OOXML_MAX_ENTRIES
    ) {
      return false;
    }

    const centralDirectoryEnd = addWithinLimit(centralDirectoryOffset, centralDirectorySize, endOffset);
    if (centralDirectoryEnd !== endOffset) return false;

    const names = new Set<string>();
    let totalUncompressedBytes = 0;
    let centralOffset = centralDirectoryOffset;

    for (let index = 0; index < totalEntries; index += 1) {
      if (centralOffset + 46 > centralDirectoryEnd || readUInt32(buffer, centralOffset) !== CENTRAL_DIRECTORY_SIGNATURE) return false;

      const flags = readUInt16(buffer, centralOffset + 8);
      const method = readUInt16(buffer, centralOffset + 10);
      const compressedSize = readUInt32(buffer, centralOffset + 20);
      const uncompressedSize = readUInt32(buffer, centralOffset + 24);
      const nameLength = readUInt16(buffer, centralOffset + 28);
      const extraLength = readUInt16(buffer, centralOffset + 30);
      const commentLength = readUInt16(buffer, centralOffset + 32);
      const diskStart = readUInt16(buffer, centralOffset + 34);
      const localHeaderOffset = readUInt32(buffer, centralOffset + 42);

      if (
        (flags & ENCRYPTION_FLAGS) !== 0 ||
        (method !== 0 && method !== 8) ||
        compressedSize === ZIP64_UINT32 ||
        uncompressedSize === ZIP64_UINT32 ||
        diskStart !== 0 ||
        localHeaderOffset === ZIP64_UINT32
      ) {
        return false;
      }

      const variableLength = nameLength + extraLength + commentLength;
      const nextCentralOffset = addWithinLimit(centralOffset + 46, variableLength, centralDirectoryEnd);
      const centralNameBytes = buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength);
      const entryName = canonicalEntryName(decodeEntryName(centralNameBytes, flags));
      if (names.has(entryName)) return false;
      names.add(entryName);

      if (
        uncompressedSize > OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES ||
        (uncompressedSize > 0 && compressedSize === 0) ||
        (compressedSize > 0 && uncompressedSize / compressedSize > OOXML_MAX_COMPRESSION_RATIO)
      ) {
        return false;
      }
      totalUncompressedBytes = addWithinLimit(totalUncompressedBytes, uncompressedSize, OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES);

      if (localHeaderOffset + 30 > centralDirectoryOffset || readUInt32(buffer, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
        return false;
      }
      const localFlags = readUInt16(buffer, localHeaderOffset + 6);
      const localMethod = readUInt16(buffer, localHeaderOffset + 8);
      const localCompressedSize = readUInt32(buffer, localHeaderOffset + 18);
      const localUncompressedSize = readUInt32(buffer, localHeaderOffset + 22);
      const localNameLength = readUInt16(buffer, localHeaderOffset + 26);
      const localExtraLength = readUInt16(buffer, localHeaderOffset + 28);
      if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength) return false;
      if ((flags & DATA_DESCRIPTOR_FLAG) === 0 && (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)) {
        return false;
      }

      const localNameStart = localHeaderOffset + 30;
      const localNameEnd = addWithinLimit(localNameStart, localNameLength, centralDirectoryOffset);
      if (!buffer.subarray(localNameStart, localNameEnd).equals(centralNameBytes)) return false;
      const dataStart = addWithinLimit(localNameEnd, localExtraLength, centralDirectoryOffset);
      addWithinLimit(dataStart, compressedSize, centralDirectoryOffset);
      centralOffset = nextCentralOffset;
    }

    return centralOffset === centralDirectoryEnd && names.has('[Content_Types].xml') && names.has(OOXML_MIME_MAIN_PART[mime]);
  } catch {
    return false;
  }
}
