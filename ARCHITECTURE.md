# ARCHITECTURE.md

Registro vivo de decisões técnicas, trade-offs e limitações. Cresce a cada etapa
do [CRONOGRAMA.md](CRONOGRAMA.md). O enunciado do desafio está em
[CHALLENGE.md](CHALLENGE.md).

---

## Como rodar

### Pré-requisitos
- Docker + Docker Compose
- (opcional, para rodar fora do container) Bun 1.x — `curl -fsSL https://bun.sh/install | bash`

### Subir tudo
```bash
cp .env.example .env          # 1ª vez apenas
docker compose up -d --build
```
Sobe três containers:
- `postgres` (PostgreSQL 16) — porta 5432
- `localstack` (SQS) — porta 4566; cria `wager-transactions.fifo` e
  `wager-transactions-dlq.fifo` (com RedrivePolicy) no boot
- `app` (NestJS sobre Bun) — porta 3000; roda `migration:up` antes de servir

### Verificar
```bash
curl -s localhost:3000/health/live      # {"status":"ok"}
curl -s localhost:3000/health/ready     # {"status":"ok","checks":{"postgres":"up","sqs":"up"}}
docker compose exec localstack awslocal sqs list-queues
docker compose exec postgres psql -U jungle -d jungle -c 'select * from mikro_orm_migrations;'
```

### Comandos de desenvolvimento (fora do container)
```bash
bun install
bun run dev              # servidor com --watch
bun run typecheck        # tsc --noEmit (modo estrito)
bun run lint             # ESLint + regras de fronteira entre camadas
bun run test             # testes de UNIDADE (bun test src) — sem infra
bun run migration:up     # aplica migrations pendentes
bun run migration:down   # reverte a última migration
bun run migration:create # cria nova migration a partir do diff de entidades
```

### Testes de integração (PostgreSQL + LocalStack reais)
```bash
bun run test:int:up      # sobe postgres + localstack e PARA o container app
bun run migration:up     # (1ª vez) aplica o schema
bun run test:int         # bun test test/integration
bun run test:all         # unidade + integração
```
> Os testes de integração precisam do `app` **parado** — ele competiria pelas
> mensagens da fila e publicaria o outbox antes das asserções. `test:int:up`
> já faz isso. `DATABASE_URL`/`SQS_*` têm defaults para `localhost` (ver
> `test/setup.ts`).

---

## Decisões — Etapa 1 (Fundação)

### Stack
| Item | Escolha | Observação |
|---|---|---|
| Runtime / package manager / test runner | Bun 1.x | exigido; `bun test` como runner |
| Linguagem | TypeScript `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` | exigido "modo estrito" |
| Framework | NestJS 11 | exigido |
| Banco | PostgreSQL 16 | exigido |
| Mensageria | AWS SQS via LocalStack 3 | exigido |
| ORM | **MikroORM 6** | ver justificativa abaixo |
| Orquestração local | Docker Compose | exigido |

### Por que MikroORM (e não TypeORM)
O desafio recomenda MikroORM pelo **Unit of Work e Identity Map explícitos**,
`EntityManager.transactional()` e `LockMode`. As Etapas 5–6 dependem
diretamente disso: a transação única que persiste `wallet + ledger + wager_transaction
+ inbox + outbox` num só commit fica natural com `em.transactional()`, e a
estratégia de concorrência (optimistic locking com `version`, com fallback
pessimista via `LockMode.PESSIMISTIC_WRITE`) é primeira-classe na API.
O mapeamento do `Money` para colunas separadas (`amount NUMERIC`, `currency`) e a
reidratação como value object serão detalhados na Etapa 3/4.

### Arquitetura em camadas (hexagonal / DDD)
```
src/
  interface/       entradas: controllers HTTP, consumidor SQS
  application/      use cases + ports (interfaces)
  domain/          regras puras — SEM @nestjs, @mikro-orm, @aws-sdk
  infrastructure/  adapters das ports: MikroORM, cliente SQS
  config/          env tipado + config única do MikroORM
```
A regra de dependência ("setas só apontam para dentro") é **verificada pelo
ESLint** (`eslint.config.mjs`): `bun run lint` falha se `domain/` importar
framework/ORM/SDK, ou se `application/` importar infraestrutura concreta.
Motivo: o critério de avaliação "Modelagem e arquitetura" pede invariantes
encapsuladas e boundaries claros, e o domínio precisa ser testável sem
levantar container.

### Configuração
- `src/config/env.ts` — objeto `env` imutável e tipado; **falha no boot** se uma
  variável obrigatória faltar (em vez de `undefined` vazando pelo sistema).
- `src/config/mikro-orm.ts` — **uma única** factory de config, usada tanto pelo
  CLI de migrations (`mikro-orm.config.ts` na raiz) quanto pelo
  `MikroOrmModule.forRoot`. Evita "migration rodou num schema, app conectou em
  outro".

### Migrations
- Versionadas, reversíveis (`up`/`down`), emitidas como TypeScript em
  `src/infrastructure/database/migrations/`.
- `ensureDatabase: false` e nenhum `synchronize`: em modo estrito o ORM **nunca**
  altera o schema em runtime — só migration versionada.
- `Migration20260101000000_init` é o baseline (vazio de propósito). O schema de
  negócio e **todas as constraints** (unicidade, `CHECK balance >= 0`, ledger
  imutável no banco) entram na Etapa 4, uma tabela por migration.
- No container, `docker-compose` roda `migration:up` antes de `bun run start`.

### Health checks
- `GET /health/live` — só diz que o processo está de pé; não toca dependências.
- `GET /health/ready` — verifica PostgreSQL (`select 1`) e SQS
  (`GetQueueAttributes`) em paralelo; retorna **503** com o detalhe de qual
  dependência caiu.
- Ambos **abertos**, sem autenticação (requisito das seções 2 e 9).
- `app.enableShutdownHooks()` já ligado no `main.ts` — base para o shutdown
  gracioso do consumidor SQS na Etapa 9 (`SIGTERM`).

### Filas SQS
- `docker/localstack/init-queues.sh` cria a fila principal FIFO e a DLQ FIFO,
  com `RedrivePolicy` (`maxReceiveCount: 5`) ligando as duas.
  `ContentBasedDeduplication` ligado só por conveniência local — a garantia real
  de idempotência é o **inbox persistente** (Etapa 9), não o dedup do broker.

### Desvios do plano
- **Pacote único**, não monorepo com workspaces. O desafio é um serviço só;
  múltiplos pacotes adicionariam cerimônia sem benefício. Reavaliável se surgir
  um segundo deployable (ex.: worker separado).
- **`ajv@^8` fixado em `devDependencies`.** O `umzug` (motor de migrations do
  MikroORM) puxa `@rushstack/node-core-library`, que exige `ajv@8`; sem o pin, o
  hoisting do Bun entregava o `ajv@6` do ESLint e o `migration:up` quebrava com
  `Cannot find module 'ajv/dist/core'`.

### Estado atual (verificado)
- `docker compose up` → 3 containers healthy.
- `/health/live` → 200; `/health/ready` → 200 com Postgres+SQS up; → 503 quando
  o Postgres cai e volta a 200 quando ele retorna.
- `migration:up` / `migration:down` funcionam dentro e fora do container.
- `bun run typecheck`, `bun run lint`, `bun test` (3 testes) passam.

---

## Decisões — Etapa 2 (`Money`)

Arquivos: `src/domain/money/` + `src/domain/shared/domain-error.ts`.

| Decisão | Escolha | Motivo |
|---|---|---|
| Lib decimal | `decimal.js` via `Decimal.clone({ precision: 40, rounding: HALF_EVEN })` | decimal exato; `clone` não polui a config global; `precision` alta só protege futura multiplicação |
| Política de arredondamento | **nenhum arredondamento acontece** | entrada limitada a ≤ 2 casas + só usamos `+ / - / negate` → resultado sempre tem 2 casas exatas. Multiplicação/divisão (reversão parcial) está fora de escopo |
| `amount` na fronteira | sempre string decimal `"25.00"`, validada por `^\d+(\.\d{1,2})?$` | um único regex rejeita `""`, `-5`, `+5`, `1e2`, `NaN`, `Infinity`, `25.001`, `12,50` |
| `currency` | `^[A-Z]{3}$` (formato ISO-4217, sem checar a lista real) | só `BRL` é usada; validar a lista inteira é fora de escopo |
| Money negativo | **permitido** internamente (`subtract`/`negate`), **proibido** em `Money.from` | direção invertida de ROLLBACK precisa de valor negativo; contrato de entrada não |
| `equals` com moedas diferentes | retorna `false`, não lança | predicado total, seguro em `Set`/dedupe |
| `add`/`subtract`/`isLessThan` com moedas diferentes | lançam `CurrencyMismatchError` | operação sem sentido = erro de domínio (testado, seção 13) |
| Erros | `DomainError` (abstrata, com `code`) → `InvalidMoneyError`, `CurrencyMismatchError` | a borda decide status HTTP por `instanceof DomainError` + `code` |
| Imutabilidade | `private constructor` + `readonly` + `Object.freeze(this)` | toda operação retorna nova instância; alias mutável compartilhado deixa de existir |

Cobertura: 42 testes (`src/domain/money/money.spec.ts`) — escala, entradas inválidas
(15 casos), aritmética exata (`0.10 + 0.20 === 0.30`), imutabilidade, predicados,
conflito de moeda, round-trip `toJSON` → `from`.

## Decisões — Etapa 3 (agregados e máquinas de estado)

Arquivos: `src/domain/wallet/`, `src/domain/wagering/`, `src/domain/shared/ledger-direction.ts`.

### Biblioteca decimal — validação
`decimal.js` é **permitido e esperado**. As únicas libs "fora do escopo" no README
(seção 4) são **ORMs além de MikroORM/TypeORM**. A restrição nº 1 (proíbe
`number`/`float`/`double` para dinheiro) *obriga* uma representação alternativa; o
esqueleto de referência da seção 6.1 usa literalmente o tipo `Decimal` (o export
do `decimal.js`). Mantemos `Decimal` 100% encapsulado (campo privado, nunca em
assinatura pública — `MoneyProps` só tem `string`), então o contrato do domínio
não depende dele. Alternativa sem dependência: centavos como `bigint` — mais
código de parsing/escala, sem ganho aqui.

### Modelagem
| Peça | Decisão | Motivo |
|---|---|---|
| `Wallet` | agregado **mutável**: `debit`/`credit` alteram saldo/versão/updatedAt | é o padrão de Aggregate Root; `Money` continua imutável dentro dele |
| `debit`/`credit` | recebem `ctx { transactionId, entryId, occurredAt }` e **retornam o `WalletLedgerEntry`** | impossível mexer no saldo sem produzir o lançamento → invariante "saldo ↔ ledger" garantida pela API, não por disciplina |
| ordem em `applyMovement` | cria o lançamento primeiro; só depois muta o estado | se a criação do lançamento falhar, a wallet fica intacta |
| `version` | nasce em 1; `+1` só quando o saldo muda; `open` com saldo inicial → continua **1** (README §9) | base do optimistic locking (Etapa 6) |
| saldo negativo | `debit` lança `InsufficientBalanceError` genérico e **não** altera o saldo | quem escolhe o `FailureCode` (`INSUFFICIENT_FUNDS` vs `REVERSAL_NEGATIVE_BALANCE`) é a aplicação, que conhece o `kind` |
| `WalletLedgerEntry` | sem campo mutável, sem transição, `Object.freeze`; `create` valida `balanceBefore ± money === balanceAfter` | imutabilidade estrutural (restrição nº 5); a mesma garantia vai para o schema na Etapa 4 |
| `WagerTransaction` | máquina de estados explícita; `PENDING`→(`PROCESSED`\|`REJECTED`\|`FAILED`\|`PENDING_REFERENCE`); terminais recusam transição com `InvalidTransactionStateError` | README 6.3: transicionar terminal é bug, não fluxo |
| `create` vs `rehydrate` | `create` valida (rejeita `OPENING`, exige referência p/ `REFUND`/`ROLLBACK`); `rehydrate` reconstrói sem validar | README 6.0 |
| erros de reversão | `WageringRuleError` (abstrata) carrega o `FailureCode` alvo | a aplicação faz `catch (e) { if (e instanceof WageringRuleError) tx.reject(e.failureCode) }` |
| `assertCanReference` | valida status `PROCESSED` da referência + kind permitido + provider/player/wallet/moeda/rodada + valor igual | README 7.2–7.5. "Já revertida pelo mesmo tipo" (7.4) fica p/ constraint no schema (Etapa 4) + caso de uso (Etapa 5) |
| `FailureCode` | enum com códigos distintos por situação operacional | README 7.2; `INSUFFICIENT_FUNDS` ≠ `REVERSAL_NEGATIVE_BALANCE` (7.9) |

Cobertura: 44 novos testes (`wallet.spec.ts`, `wallet-ledger-entry.spec.ts`,
`wager-transaction.spec.ts`), total **86** na suíte. Inclui o cenário do README §8
no nível de domínio (100 − 80 − 80 → 1 débito, saldo 20, `version` 2).

## Decisões — Etapa 4 (schema do PostgreSQL)

Arquivos: `src/infrastructure/database/migrations/Migration20260102000000_core_schema.ts`,
`src/infrastructure/database/entities/*`, `test/integration/schema.int.test.ts`.

### Mapeamento do `Money`
Duas colunas por valor: `<x>_amount NUMERIC(38,2)` + `<x>_currency CHAR(3)`.
`NUMERIC` é decimal exato do Postgres (nunca `float8`). As **entidades MikroORM
são modelos de persistência puros** (`WalletEntity` etc.), separados dos agregados
de domínio; a conversão entidade ↔ `Wallet`/`WagerTransaction` fica num mapper
(Etapa 6). Assim `src/domain` continua sem `import '@mikro-orm/*'`.

### Migration
Uma migration escrita à mão (`addSql`) em vez de gerada por diff — para controlar
índices parciais, o trigger e os `CHECK` exatamente. Reversível (`down` derruba
tudo). No container roda antes do `start`.

### Constraints (a "última linha" — restrição nº 9)
| Tabela | Constraint | Garante |
|---|---|---|
| `wallet` | `UNIQUE (player_id, currency)` | 1 wallet por player+moeda |
| `wallet` | `CHECK (balance_amount >= 0)` | saldo nunca negativo, mesmo sob race |
| `wager_transaction` | `UNIQUE (idempotency_key)` | dedup persistente da entrada |
| `wager_transaction` | `UNIQUE (provider_id, external_transaction_id)` | identidade do provedor |
| `wager_transaction` | `CHECK kind IN (...)`, `CHECK status IN (...)` | enums válidas |
| `wager_transaction` | índice parcial `WHERE status='PENDING_REFERENCE'` | worker de reprocessamento (Etapa 11) |
| `wager_transaction` | **unique parcial** `(reference_transaction_id, kind) WHERE status='PROCESSED' AND kind IN ('REFUND','ROLLBACK')` | README 7.4: não reverter 2× pelo mesmo tipo |
| `wallet_ledger_entry` | `UNIQUE (wallet_id, transaction_id)` | 1 lançamento por wallet por transação — defesa final contra débito/crédito duplicado |
| `wallet_ledger_entry` | trigger `BEFORE UPDATE OR DELETE` que lança exceção | imutabilidade estrutural (restrição nº 5) |
| `wallet_ledger_entry` | índice `(wallet_id, created_at, id)` | cursor estável do `GET /wallets/:id/ledger` |
| `inbox_message` | `PRIMARY KEY (consumer_name, message_id)` | dedup de mensagens da fila |
| `outbox_message` | índice parcial `WHERE published_at IS NULL` | varredura do worker publisher (Etapa 10) |

Trigger em vez de `REVOKE UPDATE/DELETE`: funciona para qualquer role, migration
com bug ou script manual. Verificado por 10 testes de integração contra Postgres real.

## Decisões — Etapa 5 (caso de uso único + ports + payloadHash)

Arquivos: `src/application/ports/*`, `src/application/wagering/*`, `test/fakes/*`.

### `ProcessWagerTransaction`
Um caso de uso, duas bordas (HTTP na Etapa 8, SQS na Etapa 9) montam o mesmo
`ProcessWagerTransactionCommand`. Fluxo, tudo dentro de `UnitOfWork.run` (= 1
transação SQL):

1. `source === 'sqs'` → `inbox.register(consumerName, messageId)`; duplicata → devolve o resultado já existente
2. `transactions.findByIdempotencyKey` → `matchesPayload` ? **replay** (resultado original, README 7.7) : **`IdempotencyConflictError`**
3. `WagerTransaction.create` (nasce PENDING)
4. `requiresReference()` → sem campo: `REJECTED REFERENCE_REQUIRED` · referência não achada: `PENDING_REFERENCE` + evento · `assertCanReference` falha: `REJECTED` com o `failureCode` do erro
5. `wallets.loadForUpdate` → wallet ausente / moeda divergente → `REJECTED`
6. `affectsBalance()` falso (LOSS) → `markProcessed`, sem ledger, só `WagerTransactionProcessed` · senão `wallet.debit/credit` (captura `InsufficientBalanceError` → `INSUFFICIENT_FUNDS` para BET, `REVERSAL_NEGATIVE_BALANCE` senão) → `markProcessed` → persiste wallet + transação + ledger + 2 eventos

### `payloadHash`
`SHA-256` (hex) de um **JSON canônico**: `canonicalize()` ordena chaves
recursivamente, sem espaços, descarta `undefined`. Entram só os campos de negócio
(`providerId, externalTransactionId, playerId, walletId, roundId, gameId, kind,
money, referenceExternalTransactionId?`); `money.amount` é normalizado via `Money`
(`"80"` ≡ `"80.00"`). **Não entram**: `Idempotency-Key`, `messageId`, `occurredAt`,
nem o próprio `idempotencyKey` (é a chave, não o conteúdo).

### Ports
`WalletRepository` (`loadForUpdate`/`save`), `WagerTransactionRepository`,
`LedgerRepository`, `InboxRepository` (`register → boolean`), `OutboxRepository`
(`enqueue`), `UnitOfWork` (`run(work)` com `TransactionContext` que agrupa os
repos na mesma transação), `Clock`, `IdGenerator`. Implementações concretas
(MikroORM, locking real, `em.transactional`) → Etapa 6. `observedBalance` foi
adicionado à `WagerTransaction` (`markProcessed(..., observedBalance)`) para o
replay devolver "o saldo daquele momento".

### Eventos no outbox
Por ora um `OutboxEventInput` cru (`{ aggregateId, eventType, payload, occurredAt }`).
A hierarquia `IntegrationEvent` (envelope, `eventId`, `correlationId`, versão) e o
worker publisher entram na Etapa 10.

Cobertura Etapa 5: 21 testes (`payload-hash.spec.ts`, `process-wager-transaction.use-case.spec.ts`)
com fakes em memória. Total da suíte unitária: **105**. Integração: **10**.

## Decisões — Etapa 6 (concorrência + adapters MikroORM)

Arquivos: `src/infrastructure/database/{mappers,repositories,mikro-orm-unit-of-work,
retrying-unit-of-work,concurrency.errors}`, `src/infrastructure/time/*`,
`src/infrastructure/wagering-processing.module.ts`, `test/integration/concurrency.int.test.ts`.

### Estratégia de concorrência: **optimistic locking + retry limitado**
- Leitura da wallet **não** trava a linha.
- `save()` faz `nativeUpdate(WalletEntity, { id, version: v-1 }, { balanceAmount, version: v, updatedAt })`.
  0 linhas afetadas → outra instância mexeu → `ConcurrencyConflictError`.
- `RetryingUnitOfWork` reexecuta a transação inteira (recarrega a wallet, refaz a
  regra) em `ConcurrencyConflictError` ou `DuplicateIdempotencyKeyError`.
  **Limitado** (10 tentativas, backoff linear + jitter) → esgotado, `RetriesExhaustedError`
  (borda: 503 / não-ack). Sem lock global (restrição nº 6); unidade = `walletId`.
- Alternativa pessimista (`SELECT … FOR UPDATE` / `LockMode.PESSIMISTIC_WRITE`) é
  válida e mais simples de raciocinar; escolhi optimistic para exercitar o caminho de
  retry e por casar com o `nativeUpdate` condicional. Trocável sem tocar no caso de uso.

### `UnitOfWork` real
`MikroOrmUnitOfWork.run` = `em.fork().transactional(tx => work(ctx))`. O `ctx`
carrega os 5 repositórios ligados ao **mesmo** `EntityManager`/transação. Commit ao
resolver, rollback ao lançar → wallet + ledger + transação + inbox + outbox são atômicos.

### Entidade ↔ domínio
Mappers puros em `mappers/index.ts` (`walletToDomain`, `wagerTransactionToInsert`, …).
`rehydrate` no domínio reconstrói sem revalidar; o mapper só move dados. `NUMERIC`
volta como string do driver → alimenta `Money.from` direto (exato).

### Verificação (concorrência real, `Promise.all`, Postgres real)
- **cenário §8**: 100 − 80 ∥ 80 → 1 PROCESSED, 1 REJECTED, saldo 20, **1** débito no ledger
- 50× a mesma aposta em paralelo → 1 transação, 1 débito, 49 replays
- 15 apostas ∥ para um saldo que cabe 10 → exatamente 10 PROCESSED, saldo 0, nunca negativo
- 3 wallets em paralelo → sem interferência

## Decisões — Etapa 7 (idempotência persistente)

A lógica está no caso de uso (Etapa 5). A Etapa 7 é a **prova sob concorrência e no
banco real** + a corrida de INSERT:

- `Idempotency-Key` é a fonte da verdade; persistida em `wager_transaction.idempotency_key`
  (`UNIQUE`, não em memória — restrição nº 2).
- Replay = `findByIdempotencyKey` + `matchesPayload` → devolve o **resultado original**
  (status + `observedBalance` daquele instante — README 7.7), `idempotentReplay: true`.
- Conflito = mesma key, `payloadHash` diferente → `IdempotencyConflictError` (→ 409).
- **Corrida de INSERT**: 2+ requisições passam pelo `findByIdempotencyKey` (nulo) e
  tentam inserir; o `UNIQUE` barra as perdedoras → `DuplicateIdempotencyKeyError` →
  o `RetryingUnitOfWork` reexecuta → agora `findByIdempotencyKey` acha a vencedora →
  replay. Testado com 50 requisições concorrentes → 1 efeito.

## Decisões — Etapa 8 (API HTTP)

Arquivos: `src/interface/http/*`, `src/application/wallet/*`,
`src/infrastructure/database/queries/read-models.ts`, `test/integration/http.e2e.test.ts`.

### Mapa de status (README §9 — cada situação um código)
| Situação | HTTP |
|---|---|
| payload malformado (`ValidationPipe`: amount 3 casas, campo faltando, `Idempotency-Key` ausente) | **400** |
| conflito de idempotência / wallet duplicada | **409** |
| rejeição por regra de negócio (`REJECTED` + `failureCode` no corpo) | **422** |
| aceito, processamento pendente (`PENDING_REFERENCE`) | **202** |
| retries de concorrência esgotados (`RetriesExhaustedError`) | **503** |
| recurso não encontrado | **404** |
| sucesso / replay | **200** |

`DomainExceptionFilter` (global) classifica exceções; o `POST /wagering/transactions`
decide 200/202/422 pelo `result.status` (não é exceção, é resultado).

### `CreateWallet`
`Wallet.open` → se saldo inicial > 0, monta a `WagerTransaction.opening()` (factory
**interna**, nasce `PROCESSED`) + o lançamento `CREDIT`, tudo no mesmo `uow.run`.
`WalletRepository.insert` traduz `UNIQUE(player_id,currency)` → `WalletAlreadyExistsError` → 409.

### Leituras (CQRS-lite)
`ReadModels` (infra) atende os `GET` direto, sem passar pelo caso de uso. Paginação
do ledger com **cursor opaco e estável**: base64url de `[createdAtISO, id]`,
`WHERE (created_at, id) > (?, ?) ORDER BY created_at, id` — nunca `OFFSET`.

### `ReconcileWallet`
Soma `CREDIT − DEBIT` do ledger vs `wallet.balance`; devolve `difference` e
`consistent`. Divergência não é corrigida — só sinalizada (log/métrica: Etapa 12).

Verificação: 9 testes e2e (`http.e2e.test.ts`) sobem o `AppModule` inteiro contra
Postgres real e batem via `fetch` — cria wallet, BET, replay, conflito 409,
rejeição 422, `PENDING_REFERENCE` 202, ledger paginado, reconciliação.

## Decisões — Etapa 9 (consumidor SQS + inbox)

Arquivos: `src/interface/messaging/*`, `test/integration/sqs-consumer.int.test.ts`.

- `parseWagerMessage` faz parse **estrito** (README §10). Erro → mensagem "veneno".
- `WagerMessageHandler.handle` chama o **mesmo `ProcessWagerTransaction`** do HTTP e
  classifica: `ack` (processada, inclusive REJECTED — terminal), `retry` (transitório —
  não deleta, volta pela visibility timeout; após `maxReceiveCount` a RedrivePolicy
  leva à DLQ), `dlq` (veneno — envia à DLQ + deleta).
- `SqsWagerConsumer`: long polling (20s), `DeleteMessage` (ack) **só depois** de
  `execute()` resolver (= depois do commit). `SIGTERM` (`onModuleDestroy`) → para de
  puxar e aguarda a mensagem em andamento. Não inicia o loop em `NODE_ENV=test`.
- **Dedup**: o inbox já está no caso de uso (`source:'sqs'` + `messageId` →
  `inbox.register`). `MikroOrmInboxRepository.register` faz o INSERT dentro de um
  **SAVEPOINT** (`em.transactional` aninhado) — a colisão de `(consumerName, messageId)`
  reverte só o savepoint, a transação externa segue viva para devolver o replay.
- Verificado: mensagem válida → ack + débito; malformada → dlq; **redelivery** do mesmo
  `messageId` → ack 2×, 1 efeito; round-trip real pela `wager-transactions.fifo`.

## Decisões — Etapa 10 (Transactional Outbox + worker publisher)

Arquivos: `src/application/events/*`, `src/infrastructure/outbox/*`,
`test/integration/outbox.int.test.ts`.

- `IntegrationEvent<T>` (abstrata) + 4 subclasses concretas
  (`WagerTransactionProcessed/Rejected/PendingReference`, `WalletBalanceChanged`).
  `eventType` e `version` **no tipo**; `data` carrega `MoneyProps`, nunca `Money`.
  `toJSON()` = envelope (`eventId, aggregateId, correlationId, causationId?, occurredAt
  ISO, version, data`); `toOutboxInput()` = linha da `outbox_message`.
- O caso de uso enfileira esses eventos no MESMO `uow.run` (restrição nº 4: nada
  publicado antes do commit). `correlationId` vem do comando (request/message id) ou é
  gerado; `causationId` = `messageId`.
- `OutboxPublisher.publishBatch`: `SELECT … FOR UPDATE SKIP LOCKED LIMIT n` **via
  `tx.execute`** (tem de rodar NA transação, senão o lock não vale) → publica no SQS
  (`wager-events.fifo`, `MessageDeduplicationId = outbox.id`) → `published_at = now`;
  falha → `attempts++`, `next_attempt_at = now + 2^attempts·250ms` (teto 60s).
- `OutboxPublisherWorker`: loop, roda com **N instâncias** (o `SKIP LOCKED` reparte).
  Publicação é *at-least-once* → o consumidor dos eventos deve deduplicar por `eventId`.
- Nova fila `wager-events.fifo` (init do LocalStack + `SQS_WAGER_EVENTS_URL`).
- Verificado: 2 eventos pendentes → publicados e marcados; **2 publishers concorrentes**
  → total publicado = total, sem duplicar; falha de publicação → `attempts`/`next_attempt_at`
  setados, republica no ciclo seguinte.

## Decisões — Etapa 11 (referências fora de ordem)

Arquivos: `src/application/wagering/reprocess-pending-references.use-case.ts`,
`src/infrastructure/workers/*`, `Migration20260103000000_pending_reference_retry.ts`,
`test/integration/pending-reference.int.test.ts`.

- Colunas `reference_attempts` + `reference_next_attempt_at` em `wager_transaction`
  (bookkeeping de scheduling — **fora** do agregado de domínio). Índice parcial
  ajustado para `PENDING_REFERENCE`.
- `ReprocessPendingReferences.runOnce`: pega o lote due, e por item (transação SQL
  própria) tenta resolver a referência: achou+elegível → aplica e `PROCESSED`;
  achou+inelegível → `REJECTED` com o `failureCode` da regra; não achou → backoff
  exponencial (`base·2^n`, teto 1h) até `maxAttempts` **ou** TTL, então
  `REJECTED (REFERENCE_NOT_FOUND)` + evento.
- **Limite/TTL justificados**: `maxAttempts = 10`, `ttl = 24h`. A `BET` referenciada,
  se existe, chega em segundos; 24h é folga larga sem segurar a transação para sempre.
- `PendingReferenceWorker`: loop, não roda em `NODE_ENV=test`, multi-instância seguro.

## Decisões — Etapa 12 (reconciliação + observabilidade)

Arquivos: `src/infrastructure/observability/*`, `src/interface/http/observability/*`,
`correlation.middleware.ts`, `test/integration/observability.e2e.test.ts`.

- **Logs**: `JsonLogger` (`LoggerService`) — uma linha JSON por evento, com
  `context` + os campos passados (`correlationId`, `messageId`, `transactionId`,
  `walletId`, `providerId`). Sem payloads financeiros completos.
- **`correlationId`**: `CorrelationMiddleware` lê `X-Correlation-Id` ou gera; devolve
  no header; o controller repassa ao comando → vira `correlationId` do envelope dos
  eventos. No SQS, `correlationId = messageId`.
- **Métricas** (`prom-client`, `GET /metrics`, sem auth): `wager_transactions_total`
  {status,source,kind}, `wager_transaction_duration_seconds`, `wager_idempotent_replays_total`,
  `wager_concurrency_retries_total` (do `RetryingUnitOfWork` via callback),
  `wager_sqs_messages_total`{disposition}, `wager_dlq_messages_total`,
  `wager_reconciliation_mismatch_total`, `wager_outbox_lag_seconds` + `wager_outbox_pending`
  (query no scrape) + defaults do processo.
- **Reconciliação**: `ReconcileWallet` compara `wallet.balance` com a soma do ledger;
  divergência → `consistent:false` na resposta **+** log de erro **+** métrica. Nunca
  corrige em silêncio.

## Decisões — Etapa 13 (autenticação — não pontua)

**Caminho B do README §2: não implementar, deixar o encaixe explícito.**

- `AuthGuard` (`@UseGuards`) na frente dos controllers de negócio — hoje **no-op**;
  trocar por validação de Bearer/API-key liga um IdP externo (Keycloak/Zitadel) sem
  tocar em mais nada. Health e `/metrics` ficam fora.
- `ProviderIdentity` port + `NoopProviderIdentity` — ponto de extensão para validar a
  identidade do provedor contida na mensagem.
- Mensagens da fila = canal interno confiável (sem token), **mas** o `providerId`
  segue sujeito às validações de domínio no caso de uso (a referência tem de bater
  com o mesmo provider etc.).
- Trade-off: 0 ponto na tabela; o tempo foi para concorrência/idempotência/mensageria
  (55 pontos).

## Decisões — Etapa 14 (suíte e documentação)

- **107 testes de unidade** (`bun run test`) + **41 de integração** (`bun run test:int`,
  Postgres + LocalStack reais) cobrindo a lista da seção 13: migrations/constraints,
  atomicidade wallet+ledger+inbox+outbox, inbox e redelivery, publishers concorrentes
  na mesma outbox, retry/DLQ, **cenário §8**, 50× a mesma aposta, hot wallet, ≥3
  "instâncias", worker morto entre commit e ack, `ROLLBACK` antes da referência,
  reinício com prova de `wallet.balance == ledger`.
- Setup e comandos: nesta seção "Como rodar" (o `README.md` da raiz é o enunciado do
  desafio e permanece intocado).
- `bun run test:load` (diferencial opcional): não implementado — priorizado o restante.

---

## Revisão final × README

### Falhas eliminatórias (seção 14) — nenhuma se aplica
| Falha | Como é evitada |
|---|---|
| `number` para dinheiro | `Money` sobre `decimal.js`; `number` nunca aparece |
| saldo negativo por race | optimistic lock + `CHECK (balance_amount >= 0)` — testado com 15 apostas ∥ |
| débito/crédito duplicado | `UNIQUE (wallet_id, transaction_id)` + idempotência + inbox |
| idempotência só em memória | `UNIQUE (idempotency_key)` no Postgres |
| correto só com 1 instância | testes com `Promise.all` e 4 `UnitOfWork` independentes |
| evento publicado antes do commit | outbox gravado na mesma transação; worker publica depois |
| ledger não auditável | trigger `BEFORE UPDATE OR DELETE` que lança exceção |
| testes que trocam PG/SQS por mocks | 44 testes de integração com Postgres + LocalStack reais |

### Correção aplicada nesta revisão
**Regra 7.4 (não reverter 2× pelo mesmo tipo)** devolvia `RetriesExhaustedError` →
503 em vez de `REJECTED (ALREADY_REVERSED)` → 422. Causa: o regex que classificava a
violação de `UNIQUE` casava qualquer menção a `idempotency_key`, e o *message* do erro
ecoa o `INSERT` inteiro (todas as colunas). Corrigido para casar pelo **nome da
constraint**; adicionada verificação prévia `findProcessedReversal` +
`ReversalConflictError` retryável. O saldo já estava correto (o índice único parcial
impedia o 2º crédito) — o bug era só o status. Coberto por
`test/integration/reversal.int.test.ts` (sequencial + 5 ∥).

### Adaptação em relação ao esqueleto (seção 6.5)
`InboxMessage` e `OutboxMessage` **não** são modelados como agregados de domínio
com factories — são tabela + comportamento nos adapters. Motivo: eles não guardam
invariante de negócio, só unicidade e progressão monótona de estado, ambas
garantidas onde importa:
- **Inbox**: um único `INSERT` de `(consumer_name, message_id)` na mesma transação
  SQL do efeito. Não há janela "recebida mas não processada" — é atômico. Colisão
  (`UNIQUE`) → duplicata → replay. Mais simples e mais seguro que o modelo de duas
  fases do esqueleto.
- **Outbox**: transições explícitas no `OutboxPublisher` — `publish → published_at`;
  `falha → attempts++, next_attempt_at = now + backoff`; "due" = `WHERE published_at
  IS NULL AND next_attempt_at <= now()` com `FOR UPDATE SKIP LOCKED`.
A seção 6.0 do enunciado permite adaptar nomes e assinaturas desde que as garantias
sejam preservadas.

### Limitações conhecidas (aceitas)
- `WIN` com `referenceExternalTransactionId`: a referência é **informativa** (o
  enunciado diz "*pode* referenciar"), gravada mas não resolvida/validada.
- DLQ por `maxReceiveCount`: a `RedrivePolicy` está na fila e o LocalStack a honra; o
  teste cobre o caminho `dlq` explícito (mensagem-veneno), não as 5 reentregas.
- 3 instâncias reais no Compose exigem remover `ports: "3000:3000"` ou pôr um LB na
  frente. A corretude multi-instância é provada no nível do banco pelos testes de concorrência.
- `IntegrationEvent` usa construtor com `props` em vez do `static from(...)` do
  esqueleto (o README permite adaptar assinaturas).
- `causationId` no envelope só é preenchido na entrada SQS (`= messageId`).
- `bun run test:load` (diferencial opcional) não implementado.
