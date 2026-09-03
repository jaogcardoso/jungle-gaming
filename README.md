# Distributed Wagering Processor

Serviço financeiro distribuído que processa transações de apostas
(`BET → WIN | LOSS | REFUND | ROLLBACK`) recebidas por **HTTP** e por **fila SQS**,
mantendo a correção quando as mensagens chegam **duplicadas**, **fora de ordem** ou
**em paralelo**, e mesmo quando o processo morre no meio.

- Enunciado do desafio: [CHALLENGE.md](CHALLENGE.md)
- Decisões, trade-offs e limitações: [ARCHITECTURE.md](ARCHITECTURE.md)
- Cronograma / notas de apresentação: [CRONOGRAMA.md](CRONOGRAMA.md)

---

## Stack

| Item | Escolha |
|---|---|
| Runtime / package manager / test runner | Bun 1.x |
| Linguagem | TypeScript (modo estrito) |
| Framework | NestJS 11 |
| Banco | PostgreSQL 16 |
| Mensageria | AWS SQS via LocalStack |
| ORM | MikroORM 6 |
| Orquestração local | Docker Compose |
| Métricas | prom-client (`/metrics`) |

## Arquitetura

Hexagonal / DDD. A regra de dependência ("as setas apontam para dentro") é
**verificada pelo ESLint** — `bun run lint` falha se o domínio importar
framework, ORM ou SDK de nuvem.

```
interface/       controllers HTTP, consumidor SQS        — entradas
application/      casos de uso + ports (interfaces)       — orquestração
domain/          Money, Wallet, WagerTransaction, ledger  — regras puras
infrastructure/  MikroORM, SQS, workers, observabilidade  — adapters das ports
```

O mesmo caso de uso (`ProcessWagerTransaction`) serve a entrada HTTP e a fila.
Tudo o que altera estado roda dentro de **uma transação SQL** (wallet + ledger +
transação + inbox + outbox), garantida por `EntityManager.transactional()`.

---

## Como rodar

### Pré-requisitos
- Docker + Docker Compose
- (opcional, para rodar fora do container) Bun 1.x — `curl -fsSL https://bun.sh/install | bash`

### Subir tudo

```bash
cp .env.example .env          # primeira vez
docker compose up -d --build
```

Sobe três containers:

| Serviço | Porta | O que faz |
|---|---|---|
| `postgres` | 5432 | PostgreSQL 16 |
| `localstack` | 4566 | SQS; cria `wager-transactions.fifo`, `wager-transactions-dlq.fifo` (RedrivePolicy) e `wager-events.fifo` no boot |
| `app` | 3000 | aplica as migrations e sobe a API + consumidor SQS + workers de outbox e de `PENDING_REFERENCE` |

### Verificar

```bash
curl -s localhost:3000/health/live      # {"status":"ok"}
curl -s localhost:3000/health/ready     # {"status":"ok","checks":{"postgres":"up","sqs":"up"}}
curl -s localhost:3000/metrics          # métricas Prometheus

docker compose exec localstack awslocal sqs list-queues
docker compose exec postgres psql -U jungle -d jungle -c '\dt'
```

---

## Endpoints HTTP

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/wallets` | Cria wallet; saldo inicial > 0 gera transação interna `OPENING` + lançamento `CREDIT` na mesma transação SQL |
| `GET` | `/wallets/:walletId` | Saldo e versão |
| `GET` | `/wallets/:walletId/ledger?cursor=&limit=50` | Ledger paginado (cursor opaco e estável) |
| `POST` | `/wallets/:walletId/reconciliation` | Compara saldo materializado × reconstrução pelo ledger; divergência é logada, contada em métrica e sinalizada |
| `POST` | `/wagering/transactions` | Submete uma operação. Header `Idempotency-Key` **obrigatório** |
| `GET` | `/wagering/transactions/:transactionId` | Consulta por id interno |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta por identidade do provedor |
| `GET` | `/health/live` · `/health/ready` · `/metrics` | Sem autenticação |

### Mapa de status (`POST /wagering/transactions`)

| Situação | HTTP |
|---|---|
| payload malformado / `Idempotency-Key` ausente | `400` |
| conflito de idempotência (mesma key, payload diferente) / wallet duplicada | `409` |
| rejeição por regra de negócio (`REJECTED` + `failureCode`) | `422` |
| aceito, processamento pendente (`PENDING_REFERENCE`) | `202` |
| retries de concorrência esgotados | `503` |
| sucesso / replay idempotente | `200` |

### Exemplo

```bash
curl -XPOST localhost:3000/wallets -H 'content-type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'

curl -XPOST localhost:3000/wagering/transactions \
  -H 'content-type: application/json' -H 'Idempotency-Key: provider-a:tx-123' \
  -d '{"providerId":"provider-a","externalTransactionId":"tx-123","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"<id>","roundId":"round-987","gameId":"fortune-chimp","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
```

---

## Comandos

```bash
bun install                 # dependências (ou --frozen-lockfile em CI)
bun run dev                 # servidor com --watch (fora do container)
bun run typecheck           # tsc --noEmit (modo estrito)
bun run lint                # ESLint + regras de fronteira entre camadas

bun run migration:up        # aplica migrations pendentes
bun run migration:down      # reverte a última migration (todas são reversíveis)
bun run migration:create    # nova migration a partir do diff de entidades

bun run test                # testes de UNIDADE (bun test src) — não precisa de infra
bun run test:int:up         # sobe postgres + localstack e PARA o container app
bun run test:int            # testes de INTEGRAÇÃO (PostgreSQL + LocalStack reais)
bun run test:all            # unidade + integração
```

> Os testes de integração precisam do container `app` **parado** — ele
> competiria pelas mensagens da fila e publicaria o outbox antes das asserções.
> `bun run test:int:up` já cuida disso. As variáveis `DATABASE_URL` / `SQS_*`
> têm defaults para `localhost` (ver `test/setup.ts`).

---

## Estrutura

```
src/
  domain/          Money · Wallet · WalletLedgerEntry · WagerTransaction (máquina de estados) · FailureCode
  application/      ProcessWagerTransaction · CreateWallet · ReconcileWallet · ReprocessPendingReferences
                    ports/ (repos, UnitOfWork, Clock, IdGenerator) · events/ (IntegrationEvent + subclasses) · payloadHash
  infrastructure/   repos MikroORM + mappers · MikroOrmUnitOfWork · RetryingUnitOfWork · OutboxPublisher
                    workers/ · observability/ (métricas, JSON logger) · time/
  interface/        http/ (controllers, exception filter, AuthGuard no-op, correlation middleware) · messaging/ (consumidor SQS)
test/
  fakes/            implementações em memória das ports
  integration/      44 testes contra PostgreSQL + LocalStack reais
```

---

## Decisões-chave

Detalhes e trade-offs em [ARCHITECTURE.md](ARCHITECTURE.md).

- **Dinheiro** — `Money` sobre `decimal.js`, imutável; `number`/`float` nunca aparecem. Persistido como `NUMERIC(38,2)` + `CHAR(3)`.
- **Idempotência** — `Idempotency-Key` é a fonte da verdade, persistida em `UNIQUE (idempotency_key)` (nunca em memória). `payloadHash` = SHA-256 de JSON canônico dos campos de negócio distingue *replay* de *conflito*. Fila deduplica por inbox `(consumerName, messageId)` na mesma transação SQL.
- **Concorrência** — unidade = `walletId`. Optimistic locking (`UPDATE ... WHERE version = ?`) + retry limitado (`RetryingUnitOfWork`); sem lock global. Cenário obrigatório da seção 8 coberto.
- **Mensageria** — consumidor reusa o caso de uso; `ack` só após o commit; erros classificados em negócio (ack) / transitório (retry) / veneno (DLQ). Transactional Outbox + worker publisher com `SELECT ... FOR UPDATE SKIP LOCKED`.
- **Fora de ordem** — `REFUND`/`ROLLBACK` sem a referência viram `PENDING_REFERENCE`; worker agendado reprocessa com backoff exponencial (limite 10 tentativas / TTL 24h) → `REJECTED (REFERENCE_NOT_FOUND)` + evento.
- **Schema como muralha** — `UNIQUE`, `CHECK (balance_amount >= 0)`, trigger `BEFORE UPDATE OR DELETE` que torna o ledger imutável, índices parciais. Todas as garantias no banco, não só em código.
- **Observabilidade** — logs JSON com `correlationId`/`transactionId`/`walletId`/`providerId`; métricas Prometheus (transações por status, replays, retries, DLQ, conflitos de lock, outbox lag, latência); health `live`/`ready` separados.
- **Autenticação** — não implementada (não pontua); `AuthGuard` no-op + `ProviderIdentity` port deixam o ponto de extensão explícito.

---

## Testes

- **107 de unidade** — `Money` (escala, arredondamento, entradas inválidas), invariantes da `Wallet`, regras `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK`, conflito de moeda, máquina de estados, `payloadHash`, caso de uso com fakes.
- **44 de integração** (PostgreSQL + LocalStack reais) — migrations e constraints, atomicidade wallet+ledger+inbox+outbox, inbox e redelivery, publishers concorrentes na mesma outbox, **cenário obrigatório da seção 8**, 50× a mesma aposta em paralelo, hot wallet, ≥3 "instâncias", worker morto entre commit e ack, `ROLLBACK` antes da referência (+ regra 7.4 sob concorrência), reinício com prova de `wallet.balance == reconstrução pelo ledger`.
