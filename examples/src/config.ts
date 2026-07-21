const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const integer = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
  return value;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be either true or false`);
};

const httpUrl = (name: string): string => {
  const value = required(name);
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must be an HTTP(S) URL`);
  }
  return url.toString().replace(/\/$/u, '');
};

const uploadDriver = process.env.UPLOAD_DRIVER?.trim().toLowerCase() === 's3' ? ('s3' as const) : ('local' as const);

export const appConfig = Object.freeze({
  port: integer('PORT', 3000),
  database: Object.freeze({
    url: required('DATABASE_URL'),
    synchronize: bool('DB_SYNCHRONIZE', false),
    ssl: bool('DB_SSL', false),
  }),
  keycloak: Object.freeze({
    issuer: httpUrl('KEYCLOAK_ISSUER'),
    audience: process.env.KEYCLOAK_AUDIENCE?.trim() || undefined,
  }),
  redis: Object.freeze({
    host: process.env.REDIS_HOST?.trim() || '127.0.0.1',
    port: integer('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    cacheDb: integer('REDIS_CACHE_DB', 0),
    queueDb: integer('REDIS_QUEUE_DB', 1),
  }),
  appOrigin: httpUrl('APP_ORIGIN'),
  upstreamOrigin: httpUrl('UPSTREAM_API_ORIGIN'),
  upload: Object.freeze({
    driver: uploadDriver,
    localRoot: process.env.UPLOAD_LOCAL_ROOT?.trim() || './var/uploads',
    bucket: process.env.UPLOAD_BUCKET?.trim() || undefined,
    region: process.env.AWS_REGION?.trim() || undefined,
  }),
});
