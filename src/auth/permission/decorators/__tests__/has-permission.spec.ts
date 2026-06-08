import 'reflect-metadata';
import { HasPermission } from '../has-permission.decorator';
import { HasAnyPermission } from '../has-any-permission.decorator';
import { PERMISSION_METADATA_KEY } from '../../tokens';

describe('@HasPermission / @HasAnyPermission', () => {
  it('@HasPermission sets metadata with single code', () => {
    class C {
      @HasPermission('product:create')
      m() {}
    }
    const meta = Reflect.getMetadata(PERMISSION_METADATA_KEY, C.prototype.m);
    expect(meta).toEqual(['product:create']);
  });

  it('@HasAnyPermission sets metadata with multiple codes', () => {
    class C {
      @HasAnyPermission('a', 'b', 'c')
      m() {}
    }
    const meta = Reflect.getMetadata(PERMISSION_METADATA_KEY, C.prototype.m);
    expect(meta).toEqual(['a', 'b', 'c']);
  });

  it('applies at class level too', () => {
    @HasPermission('admin:all')
    class C {}
    const meta = Reflect.getMetadata(PERMISSION_METADATA_KEY, C);
    expect(meta).toEqual(['admin:all']);
  });
});
