import 'reflect-metadata';
import {
  Schema,
  SchemaProp,
  getSchema,
  getSchemaProps,
} from '../schema.decorator';

describe('@Schema', () => {
  it('attaches class options', () => {
    @Schema({ name: 'Product', description: 'Sản phẩm' })
    class Product {}
    expect(getSchema(Product)).toEqual({ name: 'Product', description: 'Sản phẩm' });
  });

  it('returns {} when not decorated', () => {
    class Plain {}
    expect(getSchema(Plain)).toEqual({});
  });

  it('preserves arbitrary extension keys', () => {
    @Schema({ name: 'X', priority: 5, tags: ['core'] })
    class X {}
    expect(getSchema(X)).toMatchObject({ priority: 5, tags: ['core'] });
  });
});

describe('@SchemaProp', () => {
  it('accumulates per-property options', () => {
    class Form {
      @SchemaProp({ label: 'Mã', required: true })
      code!: string;
      @SchemaProp({ label: 'Tên', type: 'string' })
      name!: string;
    }
    expect(getSchemaProps(Form)).toEqual({
      code: { label: 'Mã', required: true },
      name: { label: 'Tên', type: 'string' },
    });
  });

  it('returns {} when no SchemaProp applied', () => {
    class Empty {}
    expect(getSchemaProps(Empty)).toEqual({});
  });

  it('child class inherits parent schema props', () => {
    class Parent {
      @SchemaProp({ label: 'parent-code' })
      code!: string;
    }
    class Child extends Parent {
      @SchemaProp({ label: 'name' })
      name!: string;
    }
    const props = getSchemaProps(Child);
    expect(props.code).toEqual({ label: 'parent-code' });
    expect(props.name).toEqual({ label: 'name' });
  });

  it('child override takes precedence over parent', () => {
    class P {
      @SchemaProp({ label: 'parent' })
      code!: string;
    }
    class C extends P {
      @SchemaProp({ label: 'child' })
      code!: string;
    }
    expect(getSchemaProps(C).code).toEqual({ label: 'child' });
  });
});
