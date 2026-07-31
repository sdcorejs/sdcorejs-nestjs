import {
  OOXML_MAX_COMPRESSION_RATIO,
  OOXML_MAX_ENTRIES,
  OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES,
  OOXML_MIME_MAIN_PART,
  validateOoxmlContainer,
} from './ooxml-security';

type OoxmlMime = keyof typeof OOXML_MIME_MAIN_PART;

interface ZipEntryFixture {
  name: string;
  data?: Buffer;
  flags?: number;
  method?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  centralLocalOffset?: number;
}

interface ZipFixtureOptions {
  diskNumber?: number;
  centralDirectoryDisk?: number;
  entriesOnDisk?: number;
  totalEntries?: number;
  centralDirectorySize?: number;
  centralDirectoryOffset?: number;
}

function uint16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function buildStoredZip(entries: readonly ZipEntryFixture[], options: ZipFixtureOptions = {}): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data ?? Buffer.alloc(entry.compressedSize ?? 0);
    const compressedSize = entry.compressedSize ?? data.byteLength;
    const uncompressedSize = entry.uncompressedSize ?? data.byteLength;
    const flags = entry.flags ?? 0;
    const method = entry.method ?? 0;
    const localHeader = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(flags),
      uint16(method),
      Buffer.alloc(4),
      uint32(0),
      uint32(compressedSize),
      uint32(uncompressedSize),
      uint16(name.byteLength),
      uint16(0),
      name,
    ]);
    localParts.push(localHeader, data);

    centralParts.push(
      Buffer.concat([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(flags),
        uint16(method),
        Buffer.alloc(4),
        uint32(0),
        uint32(compressedSize),
        uint32(uncompressedSize),
        uint16(name.byteLength),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(entry.centralLocalOffset ?? localOffset),
        name,
      ]),
    );
    localOffset += localHeader.byteLength + data.byteLength;
  }

  const local = Buffer.concat(localParts);
  const central = Buffer.concat(centralParts);
  const entryCount = entries.length;
  const end = Buffer.concat([
    uint32(0x06054b50),
    uint16(options.diskNumber ?? 0),
    uint16(options.centralDirectoryDisk ?? 0),
    uint16(options.entriesOnDisk ?? entryCount),
    uint16(options.totalEntries ?? entryCount),
    uint32(options.centralDirectorySize ?? central.byteLength),
    uint32(options.centralDirectoryOffset ?? local.byteLength),
    uint16(0),
  ]);
  return Buffer.concat([local, central, end]);
}

function validEntries(mime: OoxmlMime): ZipEntryFixture[] {
  return [
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: OOXML_MIME_MAIN_PART[mime], data: Buffer.from('<root/>') },
  ];
}

describe('OOXML container validation', () => {
  const word = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const sheet = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const presentation = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  it.each([word, sheet, presentation] as const)('accepts a bounded %s container with its required main part', (mime) => {
    expect(validateOoxmlContainer(buildStoredZip(validEntries(mime)), mime)).toBe(true);
  });

  it('rejects a container without [Content_Types].xml', () => {
    expect(validateOoxmlContainer(buildStoredZip([{ name: OOXML_MIME_MAIN_PART[word] }]), word)).toBe(false);
  });

  it('rejects a container without the requested family main part', () => {
    expect(validateOoxmlContainer(buildStoredZip([{ name: '[Content_Types].xml' }]), word)).toBe(false);
  });

  it('rejects a valid container from a different OOXML family', () => {
    expect(validateOoxmlContainer(buildStoredZip(validEntries(sheet)), word)).toBe(false);
  });

  it('rejects encrypted entries', () => {
    const entries = validEntries(word);
    entries[1] = { ...entries[1], flags: 0x0001 };
    expect(validateOoxmlContainer(buildStoredZip(entries), word)).toBe(false);
  });

  it('rejects duplicate canonical entries', () => {
    expect(validateOoxmlContainer(buildStoredZip([...validEntries(word), { name: OOXML_MIME_MAIN_PART[word] }]), word)).toBe(false);
  });

  it.each(['../evil.xml', '/absolute.xml', 'C:/absolute.xml', 'word\\document.xml'])('rejects unsafe entry path %s', (name) => {
    expect(validateOoxmlContainer(buildStoredZip([...validEntries(word), { name }]), word)).toBe(false);
  });

  it('rejects more entries than the bounded budget', () => {
    const entries = Array.from({ length: OOXML_MAX_ENTRIES + 1 }, (_, index) => ({ name: `custom/item-${index}.xml` }));
    entries[0] = { name: '[Content_Types].xml' };
    entries[1] = { name: OOXML_MIME_MAIN_PART[word] };
    expect(validateOoxmlContainer(buildStoredZip(entries), word)).toBe(false);
  });

  it('rejects aggregate uncompressed data above the bounded budget', () => {
    const uncompressedSize = Math.floor(OOXML_MAX_TOTAL_UNCOMPRESSED_BYTES / 3) + 1;
    const compressedSize = Math.ceil(uncompressedSize / OOXML_MAX_COMPRESSION_RATIO);
    const entries = validEntries(word);
    entries.push(
      { name: 'custom/one.bin', data: Buffer.alloc(compressedSize), method: 8, compressedSize, uncompressedSize },
      { name: 'custom/two.bin', data: Buffer.alloc(compressedSize), method: 8, compressedSize, uncompressedSize },
      { name: 'custom/three.bin', data: Buffer.alloc(compressedSize), method: 8, compressedSize, uncompressedSize },
    );
    expect(validateOoxmlContainer(buildStoredZip(entries), word)).toBe(false);
  });

  it('rejects one entry above the bounded uncompressed budget', () => {
    const uncompressedSize = OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES + 1;
    const compressedSize = Math.ceil(uncompressedSize / OOXML_MAX_COMPRESSION_RATIO);
    const entries = validEntries(word);
    entries.push({ name: 'custom/large.bin', data: Buffer.alloc(compressedSize), method: 8, compressedSize, uncompressedSize });
    expect(validateOoxmlContainer(buildStoredZip(entries), word)).toBe(false);
  });

  it('rejects an entry above the compression-ratio budget', () => {
    const entries = validEntries(word);
    entries.push({
      name: 'custom/ratio.bin',
      data: Buffer.alloc(1),
      method: 8,
      compressedSize: 1,
      uncompressedSize: OOXML_MAX_COMPRESSION_RATIO + 1,
    });
    expect(validateOoxmlContainer(buildStoredZip(entries), word)).toBe(false);
  });

  it('rejects malformed local-header offsets', () => {
    const entries = validEntries(word);
    entries[1] = { ...entries[1], centralLocalOffset: 0xffffffff - 1 };
    expect(validateOoxmlContainer(buildStoredZip(entries), word)).toBe(false);
  });

  it.each([
    { diskNumber: 1 },
    { centralDirectoryDisk: 1 },
    { entriesOnDisk: 0xffff },
    { totalEntries: 0xffff },
    { centralDirectorySize: 0xffffffff },
    { centralDirectoryOffset: 0xffffffff },
  ])('rejects multi-disk and ZIP64 sentinel metadata: %j', (options) => {
    expect(validateOoxmlContainer(buildStoredZip(validEntries(word), options), word)).toBe(false);
  });
});
