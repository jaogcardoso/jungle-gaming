import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { IdGenerator } from '../../application/ports';

/** UUID v4. */
@Injectable()
export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
