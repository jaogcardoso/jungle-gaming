import type { MoneyProps } from '../../domain/money';
import type { LedgerDirection } from '../../domain/shared/ledger-direction';
import { IntegrationEvent, type IntegrationEventProps } from './integration-event';

interface TxRef {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
}

export interface WagerTransactionProcessedData extends TxRef {
  walletId: string;
  money: MoneyProps;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;
  constructor(props: IntegrationEventProps<WagerTransactionProcessedData>) {
    super(props);
  }
}

export interface WagerTransactionRejectedData extends TxRef {
  walletId: string;
  money: MoneyProps;
  failureCode: string;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;
  constructor(props: IntegrationEventProps<WagerTransactionRejectedData>) {
    super(props);
  }
}

export interface WagerTransactionPendingReferenceData extends TxRef {
  walletId: string;
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;
  constructor(props: IntegrationEventProps<WagerTransactionPendingReferenceData>) {
    super(props);
  }
}

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

/** Emitido **somente** quando o saldo muda (README §11). */
export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;
  constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
    super(props);
  }
}
