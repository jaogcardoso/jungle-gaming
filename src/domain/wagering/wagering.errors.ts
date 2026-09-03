import { DomainError } from '../shared/domain-error';
import { FailureCode } from './failure-code';

/** Erro de **regra de negócio de wagering** que já sabe em qual `FailureCode` deve virar. */
export abstract class WageringRuleError extends DomainError {
  abstract readonly failureCode: FailureCode;
}

/** `REFUND`/`ROLLBACK` criado sem `referenceExternalTransactionId`. */
export class ReferenceRequiredError extends WageringRuleError {
  readonly code = 'REFERENCE_REQUIRED';
  readonly failureCode = FailureCode.ReferenceRequired;

  constructor(kind: string) {
    super(`${kind} exige referenceExternalTransactionId`);
  }
}

/** `REFUND` apontando para não-`BET`, ou `ROLLBACK` para tipo não permitido. */
export class ReferenceKindNotAllowedError extends WageringRuleError {
  readonly code = 'REFERENCE_KIND_NOT_ALLOWED';
  readonly failureCode = FailureCode.ReferenceKindNotAllowed;

  constructor(operation: string, referenceKind: string) {
    super(`${operation} não pode referenciar uma transação do tipo ${referenceKind}`);
  }
}

/** Referência não está `PROCESSED` (só se reverte transação aplicada). */
export class ReferenceNotProcessedError extends WageringRuleError {
  readonly code = 'REFERENCE_NOT_PROCESSED';
  readonly failureCode = FailureCode.ReferenceNotProcessed;

  constructor(referenceStatus: string) {
    super(`Referência precisa estar PROCESSED, está ${referenceStatus}`);
  }
}

/** provider/player/wallet/moeda/rodada da referência divergem da operação. */
export class ReferenceMismatchError extends WageringRuleError {
  readonly code = 'REFERENCE_MISMATCH';
  readonly failureCode = FailureCode.ReferenceMismatch;

  constructor(field: string) {
    super(`Referência não pertence ao mesmo contexto: ${field} divergente`);
  }
}

/** Valor da reversão diferente do valor da referência (reversão parcial fora de escopo). */
export class ReferenceAmountMismatchError extends WageringRuleError {
  readonly code = 'REFERENCE_AMOUNT_MISMATCH';
  readonly failureCode = FailureCode.ReferenceAmountMismatch;

  constructor(operationAmount: string, referenceAmount: string) {
    super(
      `Valor da reversão (${operationAmount}) deve ser igual ao da referência (${referenceAmount})`,
    );
  }
}

/** Transição de estado inválida (ex.: `markProcessed` numa transação já `REJECTED`). */
export class InvalidTransactionStateError extends DomainError {
  readonly code = 'INVALID_TRANSACTION_STATE';

  constructor(from: string, attempted: string) {
    super(`Transição inválida: não é possível ${attempted} a partir de ${from}`);
  }
}

/** `ledgerDirectionFor` chamado para um tipo sem lançamento (`LOSS`). Guard de programação. */
export class LedgerDirectionNotApplicableError extends DomainError {
  readonly code = 'LEDGER_DIRECTION_NOT_APPLICABLE';

  constructor(kind: string) {
    super(`${kind} não produz lançamento no ledger`);
  }
}

/** `WagerTransaction.create` recebeu `kind = OPENING` (interno, não submetível). */
export class OpeningNotSubmittableError extends DomainError {
  readonly code = 'OPENING_NOT_SUBMITTABLE';

  constructor() {
    super('OPENING é interno: não pode ser submetido pela API nem pela fila');
  }
}
