import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { buildMikroOrmConfig } from '@config/mikro-orm';

/** Conexão com o PostgreSQL via MikroORM. */
@Module({
  imports: [MikroOrmModule.forRoot(buildMikroOrmConfig())],
})
export class DatabaseModule {}
