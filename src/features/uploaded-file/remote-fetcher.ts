import axios from 'axios';
import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export interface RemoteCloneOptions {
  enabled?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedHosts?: readonly string[];
}

export interface ResolvedRemoteAddress {
  address: string;
  family: 4 | 6;
}

export interface RemoteTransportRequest {
  url: URL;
  address: ResolvedRemoteAddress;
  timeoutMs: number;
  maxBytes: number;
  headers: Readonly<Record<string, string>>;
}

export interface RemoteTransportResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  data: Buffer;
}

export interface RemoteFetchDependencies {
  lookup(hostname: string): Promise<ResolvedRemoteAddress[]>;
  request(input: RemoteTransportRequest): Promise<RemoteTransportResponse>;
}

export interface RemoteFetchResult {
  buffer: Buffer;
  contentType?: string;
  finalUrl: URL;
}

export class RemoteFileFetchError extends Error {
  constructor() {
    super('Remote file fetch failed');
    this.name = 'RemoteFileFetchError';
  }
}

function ipv4Number(address: string): number | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0;
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === undefined) return false;
  const blocked: ReadonlyArray<readonly [string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, prefix]) => inIpv4Range(value, ipv4Number(base)!, prefix));
}

function parseIpv6(address: string): Uint8Array | undefined {
  const value = address.toLowerCase().split('%', 1)[0];
  if (!value || (value.match(/::/g)?.length ?? 0) > 1) return undefined;
  let normalized = value;
  const dotted = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (dotted) {
    const ipv4 = ipv4Number(dotted);
    if (ipv4 === undefined) return undefined;
    normalized = `${normalized.slice(0, -dotted.length)}${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const [leftRaw, rightRaw] = normalized.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  const fill = normalized.includes('::') ? 8 - left.length - right.length : 0;
  if (fill < 0 || (!normalized.includes('::') && left.length !== 8)) return undefined;
  const groups = [...left, ...Array.from({ length: fill }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return Uint8Array.from(
    groups.flatMap((group) => {
      const number = Number.parseInt(group, 16);
      return [number >>> 8, number & 0xff];
    }),
  );
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  const isUnspecified = bytes.every((byte) => byte === 0);
  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (isUnspecified || isLoopback) return false;
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPublicIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  if ((bytes[0] & 0xfe) === 0xfc || (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) || bytes[0] === 0xff) return false;
  if (startsWithBytes(bytes, [0x20, 0x01, 0x0d, 0xb8]) || startsWithBytes(bytes, [0x20, 0x01, 0x00, 0x02])) return false;
  if (startsWithBytes(bytes, [0x00, 0x64, 0xff, 0x9b]) || startsWithBytes(bytes, [0x20, 0x01, 0x00, 0x00])) return false;
  if (startsWithBytes(bytes, [0x20, 0x02])) return false;
  return (bytes[0] & 0xe0) === 0x20;
}

/** Returns true only for publicly routable IPv4/IPv6 addresses. */
export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

const defaultLookup: RemoteFetchDependencies['lookup'] = async (hostname) => {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
};

const client = axios.create({
  maxRedirects: 0,
  proxy: false,
  responseType: 'arraybuffer',
  validateStatus: () => true,
});

const defaultRequest: RemoteFetchDependencies['request'] = async ({ url, address, timeoutMs, maxBytes, headers }) => {
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
  const httpAgent = new HttpAgent({ keepAlive: false, lookup: pinnedLookup });
  const httpsAgent = new HttpsAgent({ keepAlive: false, lookup: pinnedLookup });
  try {
    const response = await client.get<ArrayBuffer>(url.toString(), {
      timeout: timeoutMs,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      headers,
      httpAgent,
      httpsAgent,
    });
    const location = typeof response.headers.location === 'string' ? response.headers.location : undefined;
    const contentType = typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : undefined;
    const contentLength = typeof response.headers['content-length'] === 'string' ? response.headers['content-length'] : undefined;
    return {
      status: response.status,
      headers: { location, 'content-type': contentType, 'content-length': contentLength },
      data: Buffer.from(response.data),
    };
  } finally {
    httpAgent.destroy();
    httpsAgent.destroy();
  }
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ABSOLUTE_REMOTE_FETCH_LIMIT_BYTES = 25 * 1024 * 1024;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(minimum, Math.min(candidate, maximum));
}

/** Bounded HTTP(S) fetch with per-hop DNS validation and a pinned, public destination address. */
export async function secureFetchRemote(
  input: string,
  options: RemoteCloneOptions,
  dependencies: RemoteFetchDependencies = { lookup: defaultLookup, request: defaultRequest },
): Promise<RemoteFetchResult> {
  try {
    if (options.enabled !== true) throw new RemoteFileFetchError();
    const timeoutMs = boundedInteger(options.timeoutMs, 5_000, 1, 30_000);
    const maxBytes = boundedInteger(options.maxBytes, 10 * 1024 * 1024, 1, ABSOLUTE_REMOTE_FETCH_LIMIT_BYTES);
    const maxRedirects = boundedInteger(options.maxRedirects, 3, 0, 5);
    const allowedHosts = options.allowedHosts?.map((host) => host.toLowerCase().replace(/\.$/, ''));
    let current = new URL(input);

    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      if ((current.protocol !== 'http:' && current.protocol !== 'https:') || current.username || current.password) {
        throw new RemoteFileFetchError();
      }
      const hostname = current.hostname.toLowerCase().replace(/\.$/, '');
      if (allowedHosts?.length && !allowedHosts.includes(hostname)) throw new RemoteFileFetchError();
      const addresses = await dependencies.lookup(hostname);
      if (!addresses.length || addresses.some(({ address }) => !isPublicNetworkAddress(address))) throw new RemoteFileFetchError();

      const response = await dependencies.request({
        url: current,
        address: addresses[0],
        timeoutMs,
        maxBytes,
        headers: { accept: 'application/octet-stream' },
      });
      const declaredLength = Number(response.headers['content-length']);
      if ((Number.isFinite(declaredLength) && declaredLength > maxBytes) || response.data.byteLength > maxBytes) {
        throw new RemoteFileFetchError();
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.location;
        if (!location || redirect === maxRedirects) throw new RemoteFileFetchError();
        current = new URL(location, current);
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new RemoteFileFetchError();
      return {
        buffer: response.data,
        contentType: response.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase(),
        finalUrl: current,
      };
    }
    throw new RemoteFileFetchError();
  } catch {
    throw new RemoteFileFetchError();
  }
}
