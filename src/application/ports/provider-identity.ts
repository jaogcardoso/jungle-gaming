/** Ponto de extensão de autenticação/identidade do provedor (README §2). */
export interface ProviderIdentity {
  /** Lança se o provedor não puder ser autenticado/autorizado. */
  verify(providerId: string, credentials?: string): Promise<void>;
}

export const PROVIDER_IDENTITY = Symbol('PROVIDER_IDENTITY');

export class NoopProviderIdentity implements ProviderIdentity {
  async verify(): Promise<void> {
  }
}
