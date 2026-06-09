import 'reflect-metadata';
import { AuditSubscriber } from '../audit.subscriber';
import { BaseEntity } from '../../orm/base-entity';
import { WithAudit } from '../../orm/mixins/with-audit';
import type { IAuditStrategy } from '../strategy.interface';

class Audited extends WithAudit(BaseEntity) {}
class Plain {}

function makeStrategy(): jest.Mocked<IAuditStrategy> {
  return { onCreate: jest.fn(), onUpdate: jest.fn(), onSoftDelete: jest.fn() };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const evt = (entity: unknown): any => ({ entity });

describe('AuditSubscriber', () => {
  it('beforeInsert fills audit fields for a WithAudit entity', () => {
    const strategy = makeStrategy();
    const ctx = { store: { userId: 'u1' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = new AuditSubscriber(strategy, ctx as any);
    const entity = new Audited();
    sub.beforeInsert(evt(entity));
    expect(strategy.onCreate).toHaveBeenCalledWith(entity, { userId: 'u1' });
  });

  it('beforeInsert skips when createdBy is already set (idempotent with repo hook)', () => {
    const strategy = makeStrategy();
    const sub = new AuditSubscriber(strategy);
    const entity = Object.assign(new Audited(), { createdBy: 'pre' });
    sub.beforeInsert(evt(entity));
    expect(strategy.onCreate).not.toHaveBeenCalled();
  });

  it('beforeInsert skips a non-audit entity', () => {
    const strategy = makeStrategy();
    const sub = new AuditSubscriber(strategy);
    sub.beforeInsert(evt(new Plain()));
    expect(strategy.onCreate).not.toHaveBeenCalled();
  });

  it('beforeInsert skips when there is no entity', () => {
    const strategy = makeStrategy();
    const sub = new AuditSubscriber(strategy);
    sub.beforeInsert(evt(undefined));
    expect(strategy.onCreate).not.toHaveBeenCalled();
  });

  it('beforeUpdate delegates to onUpdate for a WithAudit entity', () => {
    const strategy = makeStrategy();
    const sub = new AuditSubscriber(strategy);
    const entity = new Audited();
    sub.beforeUpdate(evt(entity));
    expect(strategy.onUpdate).toHaveBeenCalledWith(entity, {});
  });

  it('beforeSoftRemove delegates to onSoftDelete for a WithAudit entity', () => {
    const strategy = makeStrategy();
    const sub = new AuditSubscriber(strategy);
    const entity = new Audited();
    sub.beforeSoftRemove(evt(entity));
    expect(strategy.onSoftDelete).toHaveBeenCalledWith(entity, {});
  });

  it('falls back to an empty store when no ContextService is injected', () => {
    const strategy = makeStrategy();
    const sub = new AuditSubscriber(strategy); // no contextService
    sub.beforeInsert(evt(new Audited()));
    expect(strategy.onCreate).toHaveBeenCalledWith(expect.any(Object), {});
  });
});
