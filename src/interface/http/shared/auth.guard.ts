import { type CanActivate, Injectable } from '@nestjs/common';

/** **No-op** por decisão de projeto (README §2 — autenticação não pontua). */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
