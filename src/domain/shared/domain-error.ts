/** Raiz de toda exceção de **regra de negócio**. */
export abstract class DomainError extends Error {
  /** Identificador estável e legível por máquina (ex.: "CURRENCY_MISMATCH"). */
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
