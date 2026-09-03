/** Fonte do "agora". */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
