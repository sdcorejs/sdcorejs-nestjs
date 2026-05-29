import 'reflect-metadata';
import { ForbiddenException, type ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { SdI18nExceptionFilter } from './i18n.exception.filter';
import type { II18nResolver } from './i18n.types';

const buildHost = (): { host: ArgumentsHost; sent: { status?: number; body?: unknown } } => {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
  return { host, sent };
};

const stubResolver: II18nResolver = {
  translate: (code, lang) => `[${lang ?? '-'}]${code}`,
};

describe('SdI18nExceptionFilter', () => {
  it('translates an apiError body and wraps it in an { error } envelope', () => {
    const filter = new SdI18nExceptionFilter(stubResolver, { lang: 'vi' } as never);
    const { host, sent } = buildHost();
    filter.catch(new ForbiddenException({ code: 'core.permission.forbidden', message: 'x' }), host);
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ error: { code: 'core.permission.forbidden', message: '[vi]core.permission.forbidden' } });
  });

  it('preserves data on the translated body', () => {
    const filter = new SdI18nExceptionFilter(stubResolver, { lang: 'en' } as never);
    const { host, sent } = buildHost();
    filter.catch(
      new BadRequestException({ code: 'core.validation.failed', message: 'x', data: { issues: [1] } }),
      host,
    );
    expect(sent.body).toMatchObject({ error: { code: 'core.validation.failed', data: { issues: [1] } } });
  });

  it('passes through non-apiError responses untouched', () => {
    const filter = new SdI18nExceptionFilter(stubResolver, undefined);
    const { host, sent } = buildHost();
    filter.catch(new HttpException('plain string error', 418), host);
    expect(sent.status).toBe(418);
    expect(sent.body).toBe('plain string error');
  });

  it('no-ops translation when no resolver is registered', () => {
    const filter = new SdI18nExceptionFilter(undefined, undefined);
    const { host, sent } = buildHost();
    filter.catch(new ForbiddenException({ code: 'core.permission.forbidden', message: 'orig' }), host);
    expect(sent.body).toEqual({ error: { code: 'core.permission.forbidden', message: 'orig' } });
  });
});
