// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * A regra de dependência da arquitetura hexagonal deixa de ser um diagrama e
 * passa a ser verificável: `bun run lint` falha se o domínio importar framework
 * ou biblioteca de infraestrutura.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // domain/ — núcleo puro: nada de framework, ORM ou SDK de nuvem.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'domain/ não pode depender do NestJS.' },
            { group: ['@mikro-orm/*'], message: 'domain/ não pode depender do ORM.' },
            { group: ['@aws-sdk/*'], message: 'domain/ não pode depender do SDK da AWS.' },
            { group: ['@infrastructure/*', '@interface/*'], message: 'domain/ só aponta para dentro.' },
          ],
        },
      ],
    },
  },

  // application/ — pode usar decorators de DI do Nest, mas não infraestrutura concreta.
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@mikro-orm/*'], message: 'application/ fala com ports, não com o ORM.' },
            { group: ['@aws-sdk/*'], message: 'application/ fala com ports, não com o SDK da AWS.' },
            { group: ['@infrastructure/*'], message: 'application/ não importa infraestrutura concreta.' },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
