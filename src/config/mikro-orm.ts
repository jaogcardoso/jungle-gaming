import { defineConfig, type Options } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { env } from './env';

export function buildMikroOrmConfig(): Options {
  return defineConfig({
    clientUrl: env.database.url,

    entities: ['dist/**/*.entity.js'],
    entitiesTs: ['src/**/*.entity.ts'],
    discovery: {
      warnWhenNoEntities: false,
      requireEntitiesArray: false,
    },

    pool: {
      min: env.database.poolMin,
      max: env.database.poolMax,
    },

    extensions: [Migrator],
    migrations: {
      tableName: 'mikro_orm_migrations',
      path: 'dist/infrastructure/database/migrations',
      pathTs: 'src/infrastructure/database/migrations',
      glob: '!(*.d).{js,ts}',
      emit: 'ts',
      snapshot: true,
      transactional: true,
      allOrNothing: true,
      dropTables: false,
      safe: true,
    },

    ensureDatabase: false,

    debug: process.env['MIKRO_ORM_DEBUG'] === '1',
  });
}
