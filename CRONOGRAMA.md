# Cronograma de Desenvolvimento — Distributed Wagering Processor

> Documento de planejamento e apoio à apresentação.
> Objetivo: construir o serviço descrito no [CHALLENGE.md](CHALLENGE.md) em etapas incrementais,
> cada uma com um recorte claro do problema, a lógica central e a justificativa técnica.

---

## Parte 0 — Modelo mental do sistema (para a apresentação)

Antes das etapas, os conceitos que amarram tudo. A apresentação deve começar por aqui.

### O que o sistema faz

Provedores de jogos enviam operações de aposta (`BET → WIN | LOSS | REFUND | ROLLBACK`) por
**HTTP** e por **fila SQS**. O serviço precisa aplicar essas operações ao saldo de uma carteira
(`Wallet`) e registrar cada movimento num livro-razão imutável (`ledger`), permanecendo **correto**
mesmo quando as mensagens chegam **duplicadas**, **fora de ordem** ou **em paralelo**, e mesmo
quando o processo morre no meio.

### As 4 invariantes globais (nunca podem ser violadas)

1. Não duplicar créditos.
2. Não duplicar débitos.
3. Não perder eventos confirmados.
4. Não permitir saldo negativo.

Toda decisão de arquitetura existe para proteger uma dessas quatro linhas.

### Conceitos-chave (glossário da apresentação)

| Conceito | O que é | Por que existe aqui |
|---|---|---|
| **Saldo materializado** | Uma coluna `balance` na tabela `wallet` com o valor atual | Leitura rápida (O(1)), sem somar o ledger inteiro |
| **Ledger** | Tabela imutável, uma linha por movimento, com `balanceBefore`/`balanceAfter` | Fonte de auditoria. A invariante final de todo teste é `wallet.balance == soma reconstruída do ledger` |
| **Idempotência** | Processar a mesma operação N vezes = mesmo efeito que processar 1 vez | Entrega é *at-least-once*: a mesma mensagem **vai** chegar repetida |
| **`Idempotency-Key`** | Chave estável enviada pelo provedor (`{providerId}:{externalTransactionId}`) | É a "fonte da verdade" para deduplicar. Persistida no banco, nunca só em memória |
| **`payloadHash`** | Hash de um JSON canônico (chaves ordenadas) dos campos de negócio | Distingue *replay* legítimo (mesma key + mesmo payload) de *conflito* (mesma key + payload diferente) |
| **Inbox** | Tabela que registra `(consumerName, messageId)` já processados | Deduplica mensagens da fila **dentro da mesma transação SQL** que aplica o efeito |
| **Outbox** | Tabela onde o evento de integração é gravado junto com a mudança de saldo | Garante atomicidade: ou o saldo muda **e** o evento é registrado, ou nada. Um worker publica depois |
| **Optimistic locking** | Coluna `version`; o `UPDATE` só passa se a versão não mudou; senão, retry | Evita *lost update* sem travar a linha. Alternativa: pessimistic (`SELECT ... FOR UPDATE`) |
| **Unidade de concorrência** | `walletId` | Wallets diferentes rodam 100% em paralelo; a mesma wallet é serializada |
| **`PENDING_REFERENCE`** | Estado de uma `REFUND`/`ROLLBACK` cuja transação referenciada ainda não chegou | Trata entrega fora de ordem: guarda e reprocessa depois com backoff |

### Arquitetura em camadas (hexagonal / DDD)

```
interface/         HTTP controllers, consumidor SQS  ── entradas
  │  (ambos chamam o MESMO use case)
application/        use cases + PORTS (interfaces)    ── orquestração
  │
domain/            Money, Wallet, WagerTransaction,   ── regras puras,
                   WalletLedgerEntry, FailureCode        sem ORM, sem Nest
  │
infrastructure/    MikroORM, repositórios, cliente SQS ── adapters das ports
```

**Por quê:** o domínio não conhece banco nem framework → testável isoladamente e as invariantes
ficam encapsuladas em classes (critério "Modelagem e arquitetura"). As mesmas regras servem HTTP e fila.

---

## Visão geral do cronograma

| Etapa | Tema | Critério de avaliação que ataca | Dependências |
|---|---|---|---|
| 1 | Fundação: monorepo, Docker Compose, camadas, migrations | Documentação, base de tudo | — |
| 2 | `Money` — valor monetário exato e imutável | Correção financeira | 1 |
| 3 | Agregados de domínio + máquinas de estado | Modelagem, regras de negócio | 2 |
| 4 | Schema do banco: constraints, índices, imutabilidade | Correção, Concorrência, Idempotência | 1, 3 |
| 5 | Use case único + ports + `payloadHash` | Modelagem, Idempotência | 3, 4 |
| 6 | Concorrência na wallet (locking + cenário obrigatório) | Concorrência | 5 |
| 7 | Idempotência persistente (replay vs conflito) | Idempotência | 5 |
| 8 | API HTTP + mapeamento de status | Correção, Idempotência | 5, 6, 7 |
| 9 | Consumidor SQS + Inbox | Mensageria e falhas | 5, 8 |
| 10 | Transactional Outbox + worker publisher | Mensageria e falhas | 5, 9 |
| 11 | Referências fora de ordem (`PENDING_REFERENCE`) | Mensageria, regras de negócio | 5, 10 |
| 12 | Reconciliação + Observabilidade (logs, métricas, health) | Observabilidade, Correção | 8, 10 |
| 13 | Autenticação (decisão + IdP externo ou ponto de extensão) | — (não pontua; só timebox) | 8 |
| 14 | Suíte de testes real + `README` + `ARCHITECTURE.md` | Testes, Documentação | todas |

Ordem recomendada de execução: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 14**, com a
etapa 13 encaixada em paralelo quando conveniente e a etapa 14 começando junto da etapa 2 (testes
acompanham cada camada, não ficam para o fim).

---

## Etapa 1 — Fundação: monorepo, infraestrutura local e camadas

> **Status: CONCLUÍDA E VERIFICADA.** `docker compose up` sobe os 3 containers
> healthy; `/health/live` e `/health/ready` respondendo (com 503 correto quando o
> Postgres cai); `migration:up`/`down` reversíveis; `typecheck` + `lint` + `bun test`
> verdes. Decisões registradas em [ARCHITECTURE.md](ARCHITECTURE.md).
> Ficou pacote único (não monorepo) — justificado no ARCHITECTURE.

### Objetivo
Ter `docker compose up` subindo aplicação + PostgreSQL + SQS (LocalStack/MiniStack), com a
estrutura de pastas por camadas e o ferramental de migrations funcionando.

### Entregáveis
- Workspace **Bun 1.x** + **NestJS** + **TypeScript strict** (`strict: true`, `noUncheckedIndexedAccess`).
- `docker-compose.yml`: `app`, `postgres`, `localstack` (serviço `sqs`), com healthchecks e criação
  das filas `wager-transactions.fifo` e `wager-transactions-dlq.fifo` no boot.
- Estrutura `src/{domain,application,infrastructure,interface}` + módulo Nest raiz.
- **MikroORM** configurado, com `migrations` versionadas e reversíveis (`up`/`down`).
- `GET /health/live` e `GET /health/ready` (esqueleto).
- Scripts: `bun run dev`, `bun run migration:create`, `bun run migration:up`, `bun run test`.

### Principais pontos de lógica
- **Separação de camadas desde o commit 1.** O `domain/` não importa nada de `@mikro-orm`,
  `@nestjs` nem do cliente SQS. Isso é verificável (lint rule de import boundaries) e é o que
  permite testar regras de negócio sem subir container.
- **`ready` ≠ `live`.** `live` só diz "o processo está de pé". `ready` faz ping em PostgreSQL e SQS
  — é o que um orquestrador usa para decidir se manda tráfego.
- **Migrations reversíveis** porque o desafio exige e porque é o que torna o schema uma peça
  avaliável e discutível, não um efeito colateral do ORM.

### Por quê
Sem base reprodutível, nada do resto é demonstrável. "Sobe em Docker Compose" é requisito explícito
da stack. A arquitetura hexagonal aqui não é enfeite: ela é pré-condição para os critérios de
*Modelagem* (invariantes em classes, boundaries, portas) e de *Testes* (domínio testável isolado).

### Como demonstrar na apresentação
`docker compose up` → mostrar os 3 containers saudáveis → `curl /health/ready` → mostrar o diagrama
de camadas e a regra de dependência (setas só apontam para dentro, em direção ao `domain`).

---

## Etapa 2 — `Money`: valor monetário exato e imutável

> **Status: CONCLUÍDA E VERIFICADA.** `src/domain/money/` com 42 testes passando
> (`bun test`), `typecheck` e `lint` verdes (a regra de fronteira confirma que o
> domínio não importa framework/ORM). Decisões em [ARCHITECTURE.md](ARCHITECTURE.md).

### Objetivo
Um Value Object `Money` que representa dinheiro **sem nenhum ponto flutuante**, imutável, e que
rejeita toda entrada inválida.

### Entregáveis
- `Money` com aritmética sobre uma lib decimal arbitrária (`decimal.js` / `big.js`), **nunca `number`**.
- Factories `Money.from({ amount, currency })`, `Money.zero(currency)`.
- Operações que **retornam nova instância**: `add`, `subtract`, `negate`.
- Predicados: `isZero`, `isPositive`, `isNegative`, `isLessThan`, `equals`.
- `assertSameCurrency` — operar moedas diferentes lança **erro de domínio**.
- Serialização `toJSON(): { amount, currency }` com **escala fixa de 2 casas** e `toString()`.
- Testes unitários: escala, arredondamento, e rejeição de `NaN`, `Infinity`, notação científica
  (`1e2`), string vazia, mais de 2 casas decimais, negativos em contratos de entrada, moeda inválida.

### Principais pontos de lógica
- **`amount` trafega como string decimal** (`"25.00"`), nunca como número, do request até o banco.
  A conversão para o tipo decimal acontece só dentro do `Money`.
- **Imutabilidade estrutural:** `private readonly value`, sem setters. `a.add(b)` não altera `a`.
- **Escala fixa 2** na serialização: `"25"` e `"25.000"` não existem no contrato de saída, sempre `"25.00"`.
- **Conflito de moeda é erro de domínio**, não `null` nem coerção. O sistema é multi-moeda no modelo
  mesmo assumindo `BRL` no resto do desafio — e esse conflito é testado.
- **Zero dependência de ORM/Nest.** `Money` não tem decorator nem tipo do MikroORM. Na persistência
  ele vira duas colunas (`amount NUMERIC(38,2)`, `currency CHAR(3)`) e é reidratado como `Money`.

### Por quê
`number`/`float`/`double` para dinheiro é **falha eliminatória** (seção 14). `0.1 + 0.2 !== 0.3` em
IEEE-754 — num sistema financeiro isso é dinheiro sumindo ou aparecendo. Value Object imutável elimina
uma classe inteira de bug (alias mutável compartilhado) e concentra as validações num único lugar
testável à exaustão. Vale 20 pontos de *Correção financeira* e é a fundação dos agregados.

### Como demonstrar na apresentação
Mostrar um teste que soma `"0.10" + "0.20"` e dá exatamente `"0.30"`; mostrar a rejeição de
`"1e2"` e de mais de 2 casas; mostrar que `subtract` de moedas diferentes lança.

---

## Etapa 3 — Agregados de domínio e máquinas de estado

> **Status: CONCLUÍDA E VERIFICADA.** `src/domain/wallet/` + `src/domain/wagering/`.
> 86 testes passando (`bun test`), `typecheck` + `lint` verdes. Cenário do README §8
> reproduzido no nível de domínio. `decimal.js` validado como permitido (ver
> [ARCHITECTURE.md](ARCHITECTURE.md)). O enunciado (`CHALLENGE.md`) permanece intocado.

### Objetivo
Modelar `Wallet`, `WagerTransaction` e `WalletLedgerEntry` como classes que **encapsulam suas
invariantes**, com construtor privado e factories explícitas.

### Entregáveis
- **Regra de modelagem comum:** construtor `private`/`protected` + factories estáticas
  (`create`/`open` valida regras; `rehydrate` **só reconstrói** estado persistido, sem revalidar).
- **`Wallet` (Aggregate Root):**
  - `open({ id, playerId, currency, initialBalance })`.
  - `debit(...)` / `credit(...)` que produzem **saldo novo + o `WalletLedgerEntry` correspondente**,
    consistentes entre si — nunca um sem o outro.
  - Invariantes: saldo nunca negativo; moeda da operação == moeda da wallet; `version` começa em `1`
    e **só incrementa quando o saldo muda**.
- **`WagerTransaction`:** máquina de estados explícita.
  - Nasce em `PENDING`. Estados terminais: `PROCESSED`, `REJECTED`, `FAILED`.
  - Transições: `markProcessed`, `markPendingReference`, `reject(code)`, `fail(code)` — chamar
    transição em estado terminal lança `InvalidTransactionStateError` (é bug de programação, não fluxo).
  - Consultas de domínio: `affectsBalance()` (`false` para `LOSS`), `requiresReference()` (`true`
    para `REFUND`/`ROLLBACK`), `matchesPayload(hash)`, `ledgerDirectionFor(reference?)`.
  - `OPENING` é **interno**: nunca aceito pela API nem pela fila.
- **`WalletLedgerEntry` (imutável):** sem campos mutáveis, sem métodos de transição.
  `create` valida a aritmética: `balanceBefore ± money === balanceAfter` (`isBalanced()`).
- **`FailureCode`:** taxonomia estável e legível por máquina. No mínimo, códigos distintos para:
  - saldo insuficiente numa `BET`;
  - reversão que produziria saldo negativo (situação **operacionalmente diferente** — regra 7.9);
  - referência inexistente após esgotar retries;
  - conflito de idempotência; payload inválido.
- Testes unitários: invariantes da `Wallet`; regras de `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK`;
  transições inválidas; `isBalanced` falso.

### Principais pontos de lógica
- **`create` valida, `rehydrate` confia.** Reidratar do banco não pode falhar por "transição
  inválida" — o estado já aconteceu. Misturar os dois caminhos gera bug: recusar dados válidos já
  gravados. São duas factories separadas de propósito.
- **Saldo e ledger nascem juntos.** `wallet.debit()` não retorna só o novo saldo: retorna também a
  entrada de ledger com `balanceBefore`/`balanceAfter` já preenchidos. O invariante "toda alteração
  de saldo tem um lançamento e vice-versa" é garantido pela API do agregado, não por disciplina.
- **`LOSS` não move saldo e não gera ledger** — mas gera evento `WagerTransactionProcessed`. É um
  resultado de rodada registrado, não uma movimentação.
- **`version` só sobe quando o saldo muda.** Uma transação `REJECTED` não incrementa `version`.
- **Regras de referência:**
  - `REFUND` só referencia `BET`; `ROLLBACK` referencia `BET`, `WIN` ou `REFUND`.
  - A referência deve pertencer ao **mesmo provider, player, wallet, moeda e rodada**.
  - Valor de `REFUND`/`ROLLBACK` **igual** ao da referência (reversão parcial fora de escopo).
  - Uma referência não pode ser revertida **duas vezes pelo mesmo tipo** de operação.

### Por quê
É o coração do critério *Modelagem e arquitetura* (10 pts): "invariantes encapsuladas em classes".
Construtor privado impede criar um agregado em estado inválido — não existe `new Wallet()` com saldo
negativo. Máquina de estados explícita com terminais impede o bug clássico de "processar de novo o
que já foi processado" virar uma segunda movimentação. `WalletLedgerEntry` imutável por construção
(não por convenção) é o que sustenta a auditoria: **"não sobrescrever nem excluir lançamentos"** é
restrição inviolável.

### Como demonstrar na apresentação
Diagrama da máquina de estados da `WagerTransaction` (com os 3 terminais destacados). Teste
mostrando que `BET` com saldo insuficiente → `REJECTED` com `failureCode` específico, sem ledger.
Teste mostrando que `ROLLBACK` que zeraria abaixo de zero → `REJECTED` com um `failureCode`
**diferente** do de saldo insuficiente.

---

## Etapa 4 — Schema do banco: constraints, índices e imutabilidade

> **Status: CONCLUÍDA E VERIFICADA.** Migration `..._core_schema` (reversível) +
> 5 entidades MikroORM + **10 testes de integração** contra PostgreSQL real
> (`bun run test:int`) provando que cada constraint recusa sozinha. Decisões em
> [ARCHITECTURE.md](ARCHITECTURE.md).

### Objetivo
As garantias de **unicidade**, **imutabilidade** e **não-negatividade** aplicadas **no schema**,
não só no código. O schema é peça avaliada.

### Entregáveis (migrations reversíveis)
- **`wallet`**
  - `balance_amount NUMERIC(38,2) NOT NULL`, `currency CHAR(3) NOT NULL`, `version INT NOT NULL`.
  - `UNIQUE (player_id, currency)` → no máximo uma wallet por player+moeda.
  - `CHECK (balance_amount >= 0)` → não-negatividade no banco.
- **`wager_transaction`**
  - `UNIQUE (idempotency_key)` → dedup persistente da entrada HTTP.
  - `UNIQUE (provider_id, external_transaction_id)` → dedup por identidade do provedor.
  - `payload_hash` NOT NULL; `status` com `CHECK` na enum; `kind` com `CHECK` na enum.
  - Índice para resolução de referência: `(provider_id, external_transaction_id)` (já coberto pelo unique).
  - Índice parcial `WHERE status = 'PENDING_REFERENCE'` para o worker de reprocessamento.
- **`wallet_ledger_entry`**
  - `UNIQUE (wallet_id, transaction_id)` → **no máximo um lançamento por wallet por transação**
    (a defesa final contra débito/crédito duplicado).
  - `balance_before_amount`, `balance_after_amount`, `direction` (`CHECK IN ('DEBIT','CREDIT')`).
  - **Imutabilidade no banco:** `REVOKE UPDATE, DELETE` da role da aplicação **ou** trigger
    `BEFORE UPDATE OR DELETE` que lança exceção. Documentar a escolha.
  - Índice `(wallet_id, id)` para paginação do endpoint de ledger com cursor estável.
- **`inbox_message`**: `PRIMARY KEY (consumer_name, message_id)` → dedup da fila.
- **`outbox_message`**: `id`, `aggregate_id`, `event_type`, `payload JSONB`, `occurred_at`,
  `attempts`, `next_attempt_at`, `published_at`; índice parcial `WHERE published_at IS NULL`.
- Testes de integração (PostgreSQL real): cada constraint dispara quando deve; `up`/`down` das
  migrations funcionam.

### Principais pontos de lógica
- **Defesa em profundidade.** O código já valida tudo — mas com 3+ instâncias concorrentes, só o
  banco tem a palavra final. Dois `INSERT` simultâneos de ledger para a mesma transação: um passa,
  o outro **bate no `UNIQUE (wallet_id, transaction_id)` e falha**. Sem essa constraint, o retry
  duplica o débito.
- **`CHECK (balance >= 0)`** é a última linha contra "saldo negativo causado por race" — que é
  falha eliminatória. Mesmo que a lógica de locking tivesse um furo, o `UPDATE` seria rejeitado.
- **Imutabilidade do ledger no banco**, não em código: uma migration com bug ou um script manual
  não conseguem alterar histórico. "Ledger auditável" é requisito; ledger que a aplicação pode
  reescrever não é auditável.
- **Colunas separadas para `Money`** (`amount` + `currency`), representação exata, reidratada como
  `Money`. `NUMERIC` do PostgreSQL é decimal exato — nunca `float8`.

### Por quê
Restrição inviolável nº 9, textual: *"as garantias ... devem ser aplicadas no schema do banco, não
apenas em código de aplicação. O desenho do schema, das constraints e dos índices é parte do que
está sendo avaliado."* Ataca simultaneamente *Correção*, *Concorrência* e *Idempotência*, e blinda
contra 3 das falhas eliminatórias (saldo negativo por race, débito/crédito duplicado, ledger não
auditável).

### Como demonstrar na apresentação
Mostrar o DDL das 6 tabelas com as constraints destacadas. Rodar um teste que tenta inserir dois
ledger entries para a mesma `(wallet_id, transaction_id)` e mostrar o segundo estourando
`unique_violation`. Tentar `UPDATE` num ledger entry e mostrar o erro.

---

## Etapa 5 — Use case único, ports e `payloadHash`

> **Status: CONCLUÍDA E VERIFICADA.** `src/application/ports/` + `src/application/wagering/`.
> `ProcessWagerTransaction` (um caso de uso p/ HTTP e SQS), `payloadHash` (JSON
> canônico + SHA-256), 8 ports. 21 novos testes com fakes em memória, **105** na
> suíte unitária. Locking real, adapters MikroORM e `em.transactional` → Etapa 6.

### Objetivo
Um único use case `ProcessWagerTransaction` que **serve HTTP e SQS**, definido contra **ports**
(interfaces), com o algoritmo de `payloadHash` documentado.

### Entregáveis
- **Ports** (em `application/`, implementadas em `infrastructure/`):
  `WalletRepository`, `WagerTransactionRepository`, `LedgerRepository`, `InboxRepository`,
  `OutboxRepository`, `UnitOfWork`/`TransactionRunner`, `Clock`, `IdGenerator`.
- **`ProcessWagerTransaction`** — um comando de entrada normalizado (mesma forma vindo de HTTP ou
  de mensagem SQS) e uma saída normalizada (`{ transactionId, status, balance?, idempotentReplay }`).
- **`payloadHash`**: SHA-256 de um **JSON canônico** (chaves ordenadas recursivamente, sem
  espaços, números como string decimal) do **subconjunto de campos de negócio**
  (`providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`,
  `money.amount`, `money.currency`, `referenceExternalTransactionId?`). Header e metadados de
  transporte **não entram**. Algoritmo documentado no `ARCHITECTURE.md`.
- Fluxo do use case (dentro de **uma** transação SQL — ver etapas 6 e 10 para os detalhes de
  locking e outbox):
  1. `dedup` por `idempotencyKey` → se já existe: comparar `payloadHash` → replay ou conflito.
  2. (entrada SQS) registrar `InboxMessage (consumerName, messageId)` — se já processado, sair.
  3. carregar `Wallet` com controle de concorrência.
  4. se `requiresReference()`: resolver a referência por `(providerId, referenceExternalTransactionId)`
     e validar provider/player/wallet/moeda/rodada; se ausente → `PENDING_REFERENCE`.
  5. aplicar no agregado (`debit`/`credit`/nada), obter novo saldo + ledger entry.
  6. persistir `wager_transaction` + `wallet` (novo saldo/version) + `wallet_ledger_entry` +
     `outbox_message` (+ `inbox_message`) **no mesmo commit**.
  7. retornar resultado.

### Principais pontos de lógica
- **Um use case, duas portas de entrada.** O README exige "reutilizar o mesmo use case da entrada
  HTTP" no consumidor SQS. HTTP e SQS só fazem *adaptação* (parse, auth, ack); a regra é uma só.
  Isso garante que fila e API nunca divergem de comportamento.
- **`payloadHash` sobre JSON canônico** porque `{"a":1,"b":2}` e `{"b":2,"a":1}` são o mesmo
  negócio e precisam do mesmo hash; e porque o header `Idempotency-Key` sozinho não detecta que o
  provedor reenviou a "mesma" transação com um valor diferente (isso é **conflito**, não replay).
- **Ports > implementações concretas** no use case: permite testar o fluxo com fakes em memória
  (rápido) e, na integração, com PostgreSQL/LocalStack reais (a mesma classe de use case).
- **Tudo num commit** é o que os próximos passos (outbox, inbox) dependem — aqui já se fixa a
  fronteira transacional.

### Por quê
Sustenta *Modelagem* ("boundaries, portas, simplicidade") e *Idempotência* ("payload conflitante").
Ter o use case único desde já evita retrabalho: a etapa 9 (SQS) pluga uma segunda entrada sem
reescrever regra.

### Como demonstrar na apresentação
Mostrar o mesmo `ProcessWagerTransaction` sendo chamado pelo controller e pelo consumidor. Mostrar
dois payloads com chaves em ordem diferente gerando o **mesmo** `payloadHash`, e um com `amount`
diferente gerando hash diferente → `409 Conflict`.

---

## Etapa 6 — Concorrência na wallet

> **Status: CONCLUÍDA E VERIFICADA.** Optimistic locking (`WHERE version=?`) + `RetryingUnitOfWork` (retry limitado), adapters MikroORM, `em.transactional`. Cenário §8 + 50× paralelo + hot wallet + wallets distintas: 4 testes de integração com `Promise.all` e Postgres real. Ver [ARCHITECTURE.md](ARCHITECTURE.md).

### Objetivo
Garantir correção quando **múltiplas instâncias** tocam a **mesma wallet** ao mesmo tempo. Passar
o **cenário obrigatório** da seção 8.

### Entregáveis
- Estratégia de locking escolhida e justificada no `ARCHITECTURE.md`. Recomendado:
  **optimistic locking** com `version` + **retry limitado** (ex.: 3 tentativas com jitter), com
  fallback documentado para **pessimistic** (`SELECT ... FOR UPDATE` na linha da wallet via
  `LockMode.PESSIMISTIC_WRITE`) se a taxa de conflito em "hot wallet" ficar alta.
- `UPDATE wallet SET balance=?, version=version+1, updated_at=? WHERE id=? AND version=?` —
  se `rowCount = 0`, houve concorrência → recarrega e refaz o cálculo de domínio.
- Limite de retry → em vez de loop infinito, falha transitória classificada (retorna 503 no HTTP /
  devolve visibilidade no SQS).
- Testes de concorrência com **paralelismo real** (não mocks sequenciais):
  - cenário obrigatório: saldo `100.00`, duas `BET` de `80.00` simultâneas → **1 `PROCESSED`,
    1 `REJECTED` (saldo insuficiente), saldo final `20.00`, exatamente 1 débito no ledger, nenhum
    retry duplica**;
  - a mesma aposta enviada **50× em paralelo** → 1 único débito;
  - wallets distintas em paralelo → sem serialização entre elas;
  - **≥ 3 processos** simultâneos.

### Principais pontos de lógica
- **`read → calculate → update` sem controle é proibido** (restrição 7). O `WHERE version = ?`
  transforma o update numa operação **condicional atômica**: ou ninguém mexeu desde a leitura, ou
  a linha não é afetada e o código sabe que precisa refazer.
- **Nada de lock global** (restrição 6). O lock é por `walletId`. Wallet A e wallet B nunca esperam
  uma pela outra — é isso que dá throughput com muitas instâncias.
- **Retry é limitado.** Concorrência alta na mesma wallet é esperada ("hot wallet"), mas retry
  infinito vira *livelock*. Depois do limite, é falha transitória — o provedor/fila reenvia.
- **A rejeição por saldo insuficiente é decisão de negócio**, tomada **depois** de ganhar o lock/
  vencer a condição de versão, com o saldo real em mãos. As duas apostas de `80` competem; quem
  aplica primeiro deixa `20`; a segunda recalcula, vê `20 < 80` e rejeita.

### Por quê
20 pontos de *Concorrência*. E três falhas eliminatórias moram aqui: "saldo negativo causado por
race", "débito ou crédito duplicado", "solução correta somente com uma instância". O cenário
obrigatório da seção 8 é praticamente um item de nota de corte.

### Como demonstrar na apresentação
Rodar o teste do cenário obrigatório ao vivo (ou o de 50× em paralelo) e mostrar: um `PROCESSED`,
um `REJECTED`, `SELECT count(*) FROM wallet_ledger_entry WHERE wallet_id = ...` = 1, saldo `20.00`.
Mostrar o `UPDATE ... WHERE version = ?` e explicar o caminho de retry.

---

## Etapa 7 — Idempotência persistente: replay vs conflito

> **Status: CONCLUÍDA E VERIFICADA.** Lógica na Etapa 5; aqui a prova no banco real: replay devolve o resultado original, conflito → `IdempotencyConflictError`, corrida de 50 INSERTs concorrentes → 1 efeito (via `UNIQUE` + retry). 3 testes de integração.

### Objetivo
Requisição repetida → **mesma resposta**, `idempotentReplay: true`, sem reaplicar efeito. Mesma
key com payload diferente → **conflito**, nunca replay. Deduplicação **no banco**, nunca só em memória.

### Entregáveis
- Header `Idempotency-Key` **obrigatório** no `POST /wagering/transactions` (ausência → erro de
  payload/validação).
- Resolução:
  - **key inédita** → processa, grava `idempotency_key` + `payload_hash` na `wager_transaction`.
  - **key conhecida + mesmo `payload_hash`** → retorna o **resultado original**, inclusive o
    **saldo observado naquele momento** (regra 7.7), com `idempotentReplay: true`.
  - **key conhecida + `payload_hash` diferente** → `409 Conflict`, `failureCode` de conflito.
- Corrida de dois requests idênticos concorrentes: o `UNIQUE (idempotency_key)` faz um `INSERT`
  vencer; o outro pega `unique_violation`, relê o registro vencedor e responde como replay.
- Testes: 50× em paralelo com a mesma key → 1 efeito, 50 respostas idênticas; replay depois de
  minutos ainda devolve o saldo daquela época; payload divergente → 409.

### Principais pontos de lógica
- **A chave de idempotência vive no banco, dentro da transação que aplica o efeito.** Cache em
  memória (restrição 2) não sobrevive a restart nem é compartilhado entre instâncias — duas
  instâncias com caches separados aplicariam o efeito duas vezes.
- **Replay devolve o passado, não o presente.** Se depois da `BET` original o saldo mudou por
  outras operações, o replay ainda responde o saldo que aquela `BET` enxergou. Por isso o resultado
  (status + saldo no momento) é **persistido junto com a transação**, não recalculado.
- **Conflito é sinal para o provedor**, não erro genérico: "você reusou uma key com outro
  conteúdo". Colapsar isso num 400 qualquer obriga o provedor a ler mensagem de texto pra decidir.
- **A corrida resolve-se pelo `UNIQUE`**, não por lock: barato e correto com N instâncias.

### Por quê
15 pontos de *Idempotência*. "Idempotência apenas em memória" é falha eliminatória. É o mecanismo
que torna a entrega *at-least-once* segura na porta HTTP (a fila tem o inbox, etapa 9).

### Como demonstrar na apresentação
`curl` a mesma transação 3× → primeira `idempotentReplay: false`, as outras `true`, saldo idêntico,
`SELECT count(*)` do ledger = 1. Depois, mesma key com `amount` trocado → `409` com `failureCode`.

---

## Etapa 8 — API HTTP e mapeamento de status

> **Status: CONCLUÍDA E VERIFICADA.** Controllers `wallets` + `wagering`, `CreateWallet` (com OPENING interno), `ReconcileWallet`, `ReadModels` (cursor opaco), `DomainExceptionFilter` (400/404/409/422/202/503). 9 testes e2e subindo o AppModule contra Postgres real. Ver [ARCHITECTURE.md](ARCHITECTURE.md).

### Objetivo
Expor todos os endpoints da seção 9 com um mapeamento de status HTTP **consistente entre todos os
endpoints** que distingue com clareza os tipos de resultado.

### Entregáveis
- `POST /wallets` — cria wallet; se `initialBalance > 0`, gera transação interna `OPENING` **na
  mesma transação SQL** com ledger `CREDIT`; wallet duplicada (player+moeda) → `409`.
- `GET /wallets/:walletId`
- `GET /wallets/:walletId/ledger?cursor=...&limit=50` — **cursor estável e opaco** (ex.: base64 de
  `(created_at, id)`), nunca `OFFSET`.
- `POST /wagering/transactions` (etapas 5–7).
- `GET /wagering/transactions/:transactionId`
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`
- `POST /wallets/:walletId/reconciliation` (etapa 12).
- **Mapa de status** (proposta a fixar e documentar):

  | Situação | HTTP | `body` |
  |---|---|---|
  | Payload malformado / inválido | `422` (ou `400`) | `failureCode` de validação |
  | Conflito de idempotência | `409` | `failureCode` de conflito |
  | Rejeição por regra de negócio (saldo insuficiente, referência inválida...) | `422` | `status: REJECTED` + `failureCode` |
  | Aceito, processamento pendente (`PENDING_REFERENCE`) | `202` | `status: PENDING_REFERENCE` |
  | Falha transitória de infra (lock esgotado, DB indisponível) | `503` | `failureCode` transitório + `Retry-After` |
  | Sucesso / replay | `200` | `status: PROCESSED` (+ `idempotentReplay`) |

### Principais pontos de lógica
- **Cada situação tem um código.** O README é explícito: *"colapsar essas situações num mesmo
  código obriga o provedor a interpretar mensagem de erro para decidir se pode reenviar"*.
  `409` (não reenvie igual), `422` (corrija o payload / regra violada), `202` (aceitei, aguarde),
  `503` (reenvie depois) → o provedor decide **pelo status**.
- **`OPENING` na mesma transação SQL** que o `INSERT` da wallet: ou a wallet nasce com saldo **e**
  ledger, ou não nasce. Nunca uma wallet com `balance = 1000` e ledger vazio.
- **Cursor opaco e estável:** paginação de ledger não pode "pular" ou "repetir" linhas quando
  chegam novos lançamentos. `(created_at, id)` como cursor é estável; `OFFSET` não é.

### Por quê
Suporta *Correção financeira* (reconciliação, `OPENING` atômico) e *Idempotência*. A distinção de
status é um ponto que o avaliador testa explicitamente ("a API precisa distinguir com clareza").

### Como demonstrar na apresentação
Tabela de status acima + um `curl` para cada linha mostrando o código retornado. Mostrar o
`OPENING` no ledger logo após criar a wallet.

---

## Etapa 9 — Consumidor SQS e Inbox

> **Status: CONCLUÍDA E VERIFICADA.** `WagerMessageHandler` (reusa o `ProcessWagerTransaction`), `SqsWagerConsumer` (long polling, ack pós-commit, SIGTERM), classificação ack/retry/dlq. Inbox com SAVEPOINT. 4 testes de integração (Postgres + LocalStack) incl. redelivery.

### Objetivo
Consumir `wager-transactions.fifo` reutilizando o use case, deduplicando por **inbox persistente**,
com `ack` só após o commit e classificação correta de erros.

### Entregáveis
- Consumidor que traduz a mensagem (seção 10) para o comando do use case da etapa 5.
- **Inbox:** `INSERT` em `inbox_message (consumer_name, message_id)` **dentro da mesma transação
  SQL** do efeito. Se já existe (`unique_violation` / já `processed`) → `ack` sem reprocessar.
- **`ack` somente após o commit.** Se o processo morre antes do commit, a mensagem volta pela
  *visibility timeout* e é reprocessada — o inbox garante que não duplica efeito.
- **Classificação de erro:**
  - **negócio** (saldo insuficiente, regra violada) → terminal, grava `REJECTED`, **`ack`** (não
    adianta reenviar);
  - **transitório** (DB/SQS indisponível, lock esgotado) → **não `ack`**, volta com backoff;
  - **permanente** (payload irrecuperável, veneno) → após o limite de tentativas → **DLQ**.
- **`SIGTERM`:** parar de puxar mensagens novas, concluir as em andamento **ou** devolver a
  visibilidade das não concluídas; sair limpo.
- Testes de integração (LocalStack real): redelivery sem duplicar; worker morto **depois do commit
  e antes do `ack`** → reprocessa, inbox barra o efeito duplo; retry e DLQ; `≥ 3` consumidores.

### Principais pontos de lógica
- **Inbox > SQS FIFO dedup.** Restrição 3: *"não confiar apenas em SQS FIFO"*. O
  `MessageDeduplicationId` do FIFO tem janela de 5 min; o inbox no banco é permanente e participa
  do **mesmo commit** do efeito — dedup e efeito são atômicos entre si.
- **`ack` após commit** é a regra que fecha o buraco "processei mas não confirmei": pior caso é
  reprocessar (inbox absorve), nunca perder.
- **Erro de negócio dá `ack`.** Uma `BET` sem saldo não melhora sendo reenviada 10×. Vira
  `REJECTED` (auditável) + evento e sai da fila. Só erro **transitório** merece retry.
- **`SIGTERM` gracioso** evita mensagens "presas" invisíveis até o timeout e evita commit parcial.

### Por quê
15 pontos de *Mensageria e falhas*. Cobre os cenários de teste obrigatórios 1, 4, 5 e 8 da
seção 13. Reutilizar o use case (não reimplementar) é requisito textual da seção 10.

### Como demonstrar na apresentação
Publicar a mesma mensagem 3× na fila → 1 efeito, 2 barradas pelo inbox. Matar o consumidor logo
após o `COMMIT` (ponto de kill instrumentado) e mostrar que ao reiniciar não há débito duplo.
Mostrar uma "poison message" indo para a DLQ após N tentativas.

---

## Etapa 10 — Transactional Outbox e worker publisher

> **Status: CONCLUÍDA E VERIFICADA.** `IntegrationEvent` + 4 subclasses, eventos enfileirados no mesmo commit, `OutboxPublisher` com `FOR UPDATE SKIP LOCKED` (via `tx.execute`), backoff. Fila `wager-events.fifo`. 3 testes: publish, 2 publishers concorrentes sem duplicar, falha+retry.

### Objetivo
Mudança de saldo e evento de integração **atômicos** (mesmo commit). Um worker publica os eventos
pendentes, tolerando crash e múltiplos publishers concorrentes, sem perder nem duplicar
indefinidamente.

### Entregáveis
- Gravar `outbox_message` **na mesma transação SQL** de tudo o mais. **Nunca** publicar no SQS
  dentro da transação (restrição 4: "não publicar eventos antes do commit").
- **Envelope `IntegrationEvent<T>` como classe abstrata** + uma **subclasse concreta por evento**,
  com `eventType` e `version` **no tipo** (não string solta no call site). `data` carrega
  `MoneyProps` (string), nunca a instância `Money`. `toJSON()` grava o envelope no `payload` da outbox.
- **Eventos mínimos:** `WagerTransactionProcessed` (toda transação aplicada, inclusive `LOSS`),
  `WagerTransactionRejected`, `WalletBalanceChanged` (**só** quando o saldo muda),
  `WagerTransactionPendingReference`.
- **Worker publisher:**
  - `SELECT ... FROM outbox_message WHERE published_at IS NULL AND next_attempt_at <= now()
     ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT n` → múltiplos publishers pegam lotes
    disjuntos sem pisar um no outro;
  - publica no SQS → `markPublished(now)`;
  - falha → `scheduleRetry(now)` (incrementa `attempts`, calcula `next_attempt_at` com backoff).
- Testes: commit → processo morre antes de publicar → outra instância publica; **dois publishers
  sobre a mesma outbox** sem duplicar; consumidor idempotente a evento publicado 2×.

### Principais pontos de lógica
- **Dual write é o problema.** "Grava no banco e publica no SQS" em dois passos: se o segundo
  falha, o mundo fica inconsistente (saldo mudou, ninguém soube — ou o inverso). A outbox
  transforma "publicar" numa **linha de tabela** escrita no mesmo commit → volta a ser atômico.
- **Publicação é *at-least-once*.** O worker pode publicar, morrer antes de marcar `published_at`,
  e outro republica. Logo o **consumidor tem de ser idempotente ao evento** (chave = `eventId`).
  Isso é aceitável e esperado; o proibido é *perder*.
- **`FOR UPDATE SKIP LOCKED`** é o padrão para fila-no-Postgres com N workers: cada um trava e
  processa linhas diferentes, sem lock global, sem contenção.
- **`eventType`/`version` no tipo** dá payload versionável e evita o bug de digitar a string errada
  num call site.

### Por quê
Parte central de *Mensageria e falhas* (15 pts). "Publicação de evento antes do commit" e "perder
eventos confirmados" são falha eliminatória / violação de invariante global. Cobre os cenários de
teste 5 e 6 da seção 13.

### Como demonstrar na apresentação
Diagrama: `[TX SQL: wallet + ledger + transaction + inbox + outbox] → commit → [worker] → SQS`.
Rodar dois workers apontando para a mesma outbox e mostrar que cada evento é publicado uma vez
(ou, se duplicado por crash, que o consumidor ignora o segundo por `eventId`).

---

## Etapa 11 — Referências fora de ordem (`PENDING_REFERENCE`)

> **Status: CONCLUÍDA E VERIFICADA.** Colunas de retry + índice parcial, `ReprocessPendingReferences` (backoff exponencial, maxAttempts=10 / TTL 24h → `REJECTED REFERENCE_NOT_FOUND` + evento), `PendingReferenceWorker`. 2 testes de integração: reprocessa quando a BET chega; esgota → rejeita.

### Objetivo
`REFUND`/`ROLLBACK` que chega **antes** da transação referenciada é aceito, guardado e reprocessado
depois — com limite e desfecho definidos.

### Entregáveis
- Referência ausente no momento do processamento → transação persiste como **`PENDING_REFERENCE`**
  (não `REJECTED`), com evento `WagerTransactionPendingReference` na outbox. HTTP responde `202`.
- **Worker agendado** varre `PENDING_REFERENCE` com **backoff exponencial** e tenta resolver a
  referência de novo.
- **Limite de tentativas ou TTL** definido e **justificado** (ex.: 10 tentativas / 24 h — tempo de
  sobra para a `BET` correspondente chegar, sem segurar a transação para sempre).
- Esgotado o limite → `REJECTED` com `failureCode` que identifica **referência inexistente**
  (distinto de todos os outros), + evento `WagerTransactionRejected`.
- Quando resolve dentro do prazo → aplica normalmente, `PROCESSED`, eventos correspondentes.
- Testes: `ROLLBACK`/`REFUND` entregue antes da referência (cenário 7 da seção 13); esgotar o
  limite → `REJECTED` com o código certo.

### Principais pontos de lógica
- **Fora de ordem é esperado** (seção 3: "uma operação dependente pode chegar antes da referenciada").
  Rejeitar de imediato perderia operações legítimas cuja `BET` está a 200 ms de distância.
- **`PENDING_REFERENCE` é estado explícito**, não "erro que a gente tenta de novo". Fica visível na
  API e nas métricas.
- **Backoff exponencial** evita martelar o banco reprocessando algo que talvez nunca chegue;
  **TTL/limite** evita transação zumbi eterna.
- **`failureCode` distinto** para "referência nunca apareceu" — o provedor precisa saber que o
  problema é a `BET` que ele não mandou, não o payload do `ROLLBACK`.

### Por quê
*Mensageria e falhas* + *regras de negócio* (7.1). Cenário de teste obrigatório nº 7.

### Como demonstrar na apresentação
Enviar um `ROLLBACK` de uma `BET` que ainda não existe → `202` + `PENDING_REFERENCE`. Enviar a
`BET`. Mostrar o worker resolvendo no próximo ciclo → `PROCESSED`. Em outro caso, nunca enviar a
`BET` → após o limite, `REJECTED` com `failureCode = REFERENCE_NOT_FOUND` (ou equivalente).

---

## Etapa 12 — Reconciliação e Observabilidade

> **Status: CONCLUÍDA E VERIFICADA.** `JsonLogger`, `CorrelationMiddleware` (X-Correlation-Id → envelope dos eventos), `prom-client` em `GET /metrics` (todas as métricas da seção 12), reconciliação que loga + conta métrica + sinaliza divergência sem corrigir. 2 testes e2e.

### Objetivo
Provar continuamente a invariante `wallet.balance == soma reconstruída do ledger`, e instrumentar o
sistema para diagnóstico.

### Entregáveis
- **`POST /wallets/:walletId/reconciliation`**: soma o ledger (`Σ` créditos − `Σ` débitos, ou o
  `balanceAfter` da última entrada), compara com `wallet.balance`, retorna
  `{ storedBalance, calculatedBalance, difference, consistent, checkedEntries }`.
- **Divergência não é corrigida em silêncio:** log de erro estruturado + incremento de métrica
  (`reconciliation_mismatch_total`) + `consistent: false` na resposta.
- **Logs estruturados JSON** com `correlationId`, `messageId`, `transactionId`, `walletId`,
  `providerId`. **Sem** dados sensíveis nem payloads financeiros completos (logar `amount` só
  quando necessário e como string, nunca o payload inteiro do provedor).
- **Métricas** (Prometheus-style), no mínimo: transações por `status`; duplicatas detectadas
  (HTTP replay + inbox hits); retries; mensagens em DLQ; conflitos de lock / `version`; **outbox
  lag** (idade da `outbox_message` não publicada mais antiga); latência de processamento (p50/p95/p99).
- **Health checks** já separados: `/health/live` (processo) e `/health/ready` (PostgreSQL + SQS
  alcançáveis), **sem autenticação**.
- (Opcional) OpenTelemetry tracing e um dashboard.

### Principais pontos de lógica
- **`correlationId` atravessa tudo:** HTTP request → use case → outbox → evento → consumidor. É o
  fio que permite reconstruir uma operação inteira nos logs.
- **Outbox lag** é o KPI de saúde do pipeline assíncrono: se sobe, o worker publisher está parado
  ou lento — eventos confirmados não estão saindo.
- **Reconciliação é ativa, não passiva.** O sistema oferece o endpoint para provar consistência a
  qualquer momento; divergência vira alarme, nunca "auto-correção" que mascara o bug.
- **Sem payload financeiro no log** por conformidade e para não vazar dados do provedor/jogador.

### Por quê
5 pontos de *Observabilidade* + reforça *Correção financeira*. A invariante final de **todos** os
testes da seção 13 é exatamente o que a reconciliação verifica.

### Como demonstrar na apresentação
Rodar reconciliação numa wallet com histórico → `consistent: true`, `checkedEntries: N`. Mostrar
um log estruturado de uma `BET` com o `correlationId`. Mostrar o painel/JSON de métricas com
`transactions_total{status="PROCESSED"}`, `outbox_lag_seconds`, `dlq_messages_total`.

---

## Etapa 13 — Autenticação (decisão de projeto — não pontua)

> **Status: CONCLUÍDA.** Caminho B: `AuthGuard` no-op + `ProviderIdentity` port como pontos de extensão explícitos, decisão e trade-off documentados no ARCHITECTURE. IdP externo não implementado de propósito (0 ponto).

### Objetivo
Tomar e **documentar** uma decisão sobre autenticação sem deixá-la competir com o timebox das
partes que valem pontos.

### Entregáveis — escolher **um** caminho:
- **Caminho A (implementar):** subir **Keycloak** ou **Zitadel** no Docker Compose, proteger os
  endpoints HTTP (exceto health) via **OIDC** (`AuthGuard` validando JWT do IdP). Nada de tabela
  própria de usuários com hash de senha.
- **Caminho B (não implementar):** documentar no `ARCHITECTURE.md` o desenho que seria adotado,
  e deixar o **ponto de extensão explícito no código** — `AuthGuard` no-op e/ou uma port
  `ProviderIdentityPort` onde a verificação entraria.

### Principais pontos de lógica
- **Autenticação = 0 ponto** na tabela da seção 14. O README pede explicitamente para dimensionar
  o timebox por isso. A decisão será discutida na apresentação — ter uma justificativa clara vale
  mais que uma implementação apressada.
- **Health aberto**, sempre (`/health/live`, `/health/ready`).
- **Mensagens da fila = canal interno confiável** — não exigem token — **mas** o
  `providerId`/identidade contido na mensagem continua sujeito às **validações de domínio**
  (a referência tem de bater com o mesmo provider etc.). "Canal confiável" não é "pula as regras".
- Se implementar: **IdP externo**, não auth artesanal.

### Por quê
Puramente gestão de escopo. O erro a evitar é gastar dias em Keycloak e chegar fraco em
concorrência/idempotência, que somam 55 pontos.

### Como demonstrar na apresentação
Um slide: "decidimos X porque Y; o ponto de extensão está em `AuthGuard`/`ProviderIdentityPort`;
o trade-off é Z". Se caminho A: um `curl` sem token → `401`, com token do Keycloak → `200`.

---

## Etapa 14 — Suíte de testes real, `README` e `ARCHITECTURE.md`

> **Status: CONCLUÍDA.** 107 testes de unidade + 41 de integração (Postgres + LocalStack reais) cobrindo a lista da seção 13. README.md do projeto com setup/comandos; enunciado preservado em CHALLENGE.md. `test:load` (opcional) não feito.

### Objetivo
Fechar a cobertura de testes exigida pela seção 13 (com PostgreSQL e SQS **reais** em containers) e
entregar a documentação.

### Entregáveis
- **Unidade:** `Money` (escala, arredondamento, entradas inválidas); invariantes da `Wallet`;
  regras `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK`; conflito de moeda; idempotency key com payload
  divergente.
- **Integração (containers reais):** migrations e constraints; atomicidade wallet+ledger+inbox+
  outbox; inbox e redelivery; publishers concorrentes sobre a mesma outbox; retry e DLB; recuperação
  após reinício.
- **Concorrência (paralelismo real, sem mocks sequenciais):** os 8 cenários da seção 13 —
  50× a mesma aposta → 1 débito; disputa de saldo (cenário da seção 8); wallets distintas em
  paralelo; ≥ 3 instâncias; worker morto entre commit e `ack`; dois publishers na mesma outbox;
  `ROLLBACK`/`REFUND` antes da referência; reinício com prova de consistência final.
- **Invariante final assertada em todo teste que mexe em saldo:**
  `wallet.balance == saldo reconstruído pelo ledger`.
- **`README.md`**: setup, comandos (`docker compose up`, migrations, `bun run test`,
  `bun run test:integration`, `bun run test:concurrency`).
- **`ARCHITECTURE.md`**: escolha de ORM e mapeamento de `Money`; estratégia transacional;
  estratégia de concorrência e por quê; algoritmo do `payloadHash`; taxonomia de `failureCode`;
  TTL/limite de `PENDING_REFERENCE`; decisão de autenticação; trade-offs e limitações conhecidas.
- **(Opcional / diferencial)** `bun run test:load` com ambiente, metodologia, throughput,
  p50/p95/p99, taxa de erro, conflitos de concorrência e outbox lag registrados honestamente.

### Principais pontos de lógica
- **"Testes que substituem completamente PostgreSQL e SQS por mocks" é falha eliminatória.** A
  arquitetura de ports (etapa 5) permite fakes rápidos no nível de unidade **e** os mesmos use
  cases contra infra real na integração — as duas coisas, não uma no lugar da outra.
- **Concorrência exige paralelismo de verdade:** `Promise.all` de N requests HTTP contra o serviço
  rodando com múltiplos workers, não N chamadas sequenciais a um mock.
- **A invariante `balance == ledger` como asserção final** de cada teste é a rede de segurança:
  qualquer bug de duplicação/perda aparece como divergência.
- **`ARCHITECTURE.md` é onde os pontos de "Documentação" (5) e boa parte da nota de "Modelagem"
  são defendidos** — decisões justificadas, trade-offs explícitos.

### Por quê
10 pontos de *Testes* + 5 de *Documentação*, e é a evidência que sustenta todos os outros critérios
na apresentação ("está correto? prove").

### Como demonstrar na apresentação
Rodar `bun run test:concurrency` ao vivo. Abrir o `ARCHITECTURE.md` nas seções de concorrência e
idempotência. Mostrar um teste de integração derrubando e subindo o serviço e reconciliando no fim.

---

## Roteiro sugerido da apresentação (15–20 min)

1. **Problema** (2 min): processador financeiro distribuído; entrega *at-least-once*; as 4
   invariantes globais.
2. **Modelo de domínio** (3 min): `Money` imutável; `Wallet` + `ledger` (saldo materializado vs
   auditoria); máquina de estados da `WagerTransaction`.
3. **O schema como garantia** (2 min): constraints de unicidade, `CHECK >= 0`, ledger imutável no banco.
4. **Concorrência** (3 min): unidade = `walletId`; optimistic locking + retry; **cenário obrigatório
   ao vivo**.
5. **Idempotência** (2 min): `Idempotency-Key` + `payloadHash`; replay vs conflito; inbox para a fila.
6. **Pipeline assíncrono** (3 min): transação SQL única (wallet+ledger+inbox+outbox) → worker
   publisher com `SKIP LOCKED` → consumidor idempotente; crash recovery.
7. **Fora de ordem** (1 min): `PENDING_REFERENCE` + worker com backoff/TTL.
8. **Observabilidade & reconciliação** (1 min): `correlationId`, outbox lag, `balance == ledger`.
9. **Decisões e trade-offs** (2 min): ORM, estratégia de lock, autenticação, limitações.
