# domain/

Núcleo de regras de negócio. **Não importa** `@nestjs/*`, `@mikro-orm/*` nem
`@aws-sdk/*` — essa restrição é verificada pelo ESLint (`eslint.config.mjs`).

Conteúdo previsto:

- **Etapa 2** — `Money` (value object monetário exato e imutável).
- **Etapa 3** — agregados `Wallet`, `WagerTransaction`, `WalletLedgerEntry`,
  enums de estado e a taxonomia de `FailureCode`.

Regra de modelagem: construtor `private`/`protected` + factories estáticas
(`create`/`open` validam; `rehydrate` apenas reconstrói estado já persistido).
