/**
 * Ponto de entrada que o CLI do MikroORM procura (referenciado em
 * package.json > "mikro-orm" > configPaths).
 *
 * Toda a configuração vive em src/config/mikro-orm.ts para ser reaproveitada
 * pelo módulo Nest.
 */
import { buildMikroOrmConfig } from './src/config/mikro-orm';

export default buildMikroOrmConfig();
