# application/

Orquestração dos casos de uso e definição das **ports** (interfaces que a
infraestrutura implementa). Não importa `@mikro-orm/*` nem `@aws-sdk/*`.

Conteúdo previsto:

- **Etapa 5** — `ProcessWagerTransaction` (use case único, compartilhado entre a
  entrada HTTP e o consumidor SQS) e as ports: `WalletRepository`,
  `WagerTransactionRepository`, `LedgerRepository`, `InboxRepository`,
  `OutboxRepository`, `UnitOfWork`, `Clock`, `IdGenerator`.
- **Etapa 5** — algoritmo do `payloadHash` (JSON canônico dos campos de negócio).
