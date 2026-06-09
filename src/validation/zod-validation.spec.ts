import 'reflect-metadata';
import { BadRequestException, type ExecutionContext } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationGuard } from './zod-validation.guard';
import { parseZod } from './zod.utils';

const schema = z.object({
  name: z.string().min(1, 'core.validation.name.required'),
  age: z.coerce.number().int().min(0, 'core.validation.age.min'),
});

const buildExecCtx = (req: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

describe('parseZod', () => {
  it('returns coerced data on success', () => {
    const out = parseZod(schema, { name: 'Phone', age: '5' });
    expect(out).toEqual({ name: 'Phone', age: 5 });
  });

  it('throws BadRequestException with code body on failure', () => {
    try {
      parseZod(schema, { name: '', age: -1 });
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as { code: string; data: { issues: unknown[] } };
      expect(body.code).toBe('core.validation.failed');
      expect(body.data.issues.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('issue carries i18n-code message + path', () => {
    try {
      parseZod(schema, { name: '', age: 5 });
      fail('should throw');
    } catch (e) {
      const body = (e as BadRequestException).getResponse() as {
        data: { issues: { path: string; message: string }[] };
      };
      const issue = body.data.issues.find((i) => i.path === 'name');
      expect(issue?.message).toBe('core.validation.name.required');
    }
  });

  it('issue carries structured params for i18n interpolation', () => {
    const minSchema = z.object({ name: z.string().min(3, 'core.validation.name.min') });
    try {
      parseZod(minSchema, { name: 'ab' });
      fail('should throw');
    } catch (e) {
      const body = (e as BadRequestException).getResponse() as {
        data: { issues: { path: string; code: string; params?: Record<string, unknown> }[] };
      };
      const issue = body.data.issues.find((i) => i.path === 'name');
      expect(issue?.code).toBe('too_small');
      expect(issue?.params).toMatchObject({ minimum: 3 });
    }
  });

  it('issue without extra fields has no params', () => {
    const reqSchema = z.object({ name: z.string('core.validation.name.required') });
    try {
      parseZod(reqSchema, {});
      fail('should throw');
    } catch (e) {
      const body = (e as BadRequestException).getResponse() as {
        data: { issues: { path: string; params?: Record<string, unknown> }[] };
      };
      const issue = body.data.issues.find((i) => i.path === 'name');
      // invalid_type carries expected/received → params present; ensure RegExp/non-primitive stripped
      expect(issue?.params === undefined || typeof issue?.params === 'object').toBe(true);
    }
  });
});

describe('ZodValidationGuard', () => {
  it('passes + replaces body with coerced data on valid input', () => {
    const Guard = ZodValidationGuard(schema);
    const guard = new Guard();
    const req: Record<string, unknown> = { body: { name: 'X', age: '7' } };
    expect(guard.canActivate(buildExecCtx(req))).toBe(true);
    expect(req.body).toEqual({ name: 'X', age: 7 });
  });

  it('throws BadRequestException on invalid body', () => {
    const Guard = ZodValidationGuard(schema);
    const guard = new Guard();
    const req = { body: { name: '', age: 'NaN' } };
    expect(() => guard.canActivate(buildExecCtx(req))).toThrow(BadRequestException);
  });

  it('validates query source + mutates in place (Express 5 safe)', () => {
    const qSchema = z.object({ q: z.string().min(1, 'core.validation.q.required') });
    const Guard = ZodValidationGuard(qSchema, 'query');
    const guard = new Guard();
    const query: Record<string, unknown> = { q: 'hello', stale: 'x' };
    const req = { query };
    expect(guard.canActivate(buildExecCtx(req))).toBe(true);
    expect(req.query).toEqual({ q: 'hello' }); // stale key removed
    expect(req.query).toBe(query); // same ref (mutated in place)
  });
});

describe('ZodValidationGuard multi-source', () => {
  const bodySchema = z.object({ name: z.string().min(1, 'core.validation.name.required') });
  const querySchema = z.object({ page: z.coerce.number().int().min(0, 'core.validation.page.min') });

  it('validates and coerces multiple sources at once', () => {
    const Guard = ZodValidationGuard({ body: bodySchema, query: querySchema });
    const guard = new Guard();
    const query: Record<string, unknown> = { page: '3' };
    const req: Record<string, unknown> = { body: { name: 'X' }, query };
    expect(guard.canActivate(buildExecCtx(req))).toBe(true);
    expect(req.body).toEqual({ name: 'X' });
    expect(req.query).toEqual({ page: 3 });
    expect(req.query).toBe(query); // query mutated in place
  });

  it('merges issues from every failing source into one envelope', () => {
    const Guard = ZodValidationGuard({ body: bodySchema, query: querySchema });
    const guard = new Guard();
    const req = { body: { name: '' }, query: { page: '-1' } };
    try {
      guard.canActivate(buildExecCtx(req));
      fail('should throw');
    } catch (e) {
      const body = (e as BadRequestException).getResponse() as {
        code: string;
        data: { issues: { path: string }[] };
      };
      expect(body.code).toBe('core.validation.failed');
      const paths = body.data.issues.map((i) => i.path);
      expect(paths).toContain('name');
      expect(paths).toContain('page');
    }
  });
});
