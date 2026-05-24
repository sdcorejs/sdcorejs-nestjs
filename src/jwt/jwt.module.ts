import { type DynamicModule, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { JWT_CONFIG, type JwtConfig } from './types';

@Module({})
export class JwtModule {
  static forRoot(config: JwtConfig): DynamicModule {
    return {
      module: JwtModule,
      global: true,
      imports: [PassportModule],
      providers: [{ provide: JWT_CONFIG, useValue: config }, JwtStrategy],
      exports: [JWT_CONFIG, JwtStrategy, PassportModule],
    };
  }
}
