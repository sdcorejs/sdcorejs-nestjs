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
    const hasSecret = typeof config.secret === 'string' && config.secret.trim().length > 0;
    const hasJwks = config.jwks !== undefined;
    if (config.secret !== undefined && !hasSecret) {
      throw new Error('JwtConfig.secret must be a non-empty string when supplied');
    }
    if (hasSecret && hasJwks) {
      throw new Error('JwtConfig.secret and JwtConfig.jwks are mutually exclusive verification modes');
    }
    if (!options?.strategy && !hasSecret && !hasJwks) {
      throw new Error('JwtModule.forRoot requires either JwtConfig.secret or JwtConfig.jwks for its default strategy');
    }

    const Strat = options?.strategy ?? (hasJwks ? KeycloakJwtStrategy : JwtStrategy);
    return {
      module: JwtModule,
      global: true,
      imports: [PassportModule, ...(options?.imports ?? [])],
      providers: [{ provide: JWT_CONFIG, useValue: config }, Strat],
      exports: [JWT_CONFIG, Strat, PassportModule],
    };
  }
}
