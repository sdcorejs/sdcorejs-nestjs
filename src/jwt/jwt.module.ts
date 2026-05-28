import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { KeycloakJwtStrategy } from './keycloak-jwt.strategy';
import { JWT_CONFIG, type JwtConfig } from './types';

export interface JwtModuleOptions {
  /**
   * Strategy class to register — typically your `validate`-enriching subclass of
   * `KeycloakJwtStrategy` / `JwtStrategy`. Defaults to `KeycloakJwtStrategy` when `config.jwks`
   * is set, otherwise the symmetric `JwtStrategy`.
   */
  strategy?: Type<unknown>;
  /** Extra modules to import so a custom `strategy`'s constructor deps resolve (e.g. UserModule). */
  imports?: (DynamicModule | Type<unknown>)[];
}

@Module({})
export class JwtModule {
  static forRoot(config: JwtConfig, options?: JwtModuleOptions): DynamicModule {
    const Strat = options?.strategy ?? (config.jwks ? KeycloakJwtStrategy : JwtStrategy);
    return {
      module: JwtModule,
      global: true,
      imports: [PassportModule, ...(options?.imports ?? [])],
      providers: [{ provide: JWT_CONFIG, useValue: config }, Strat],
      exports: [JWT_CONFIG, Strat, PassportModule],
    };
  }
}
