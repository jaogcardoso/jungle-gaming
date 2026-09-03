/** Carregamento e validação da configuração de ambiente. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Variável de ambiente inválida (esperado inteiro >= 0): ${name}=${raw}`);
  }
  return parsed;
}

export interface Env {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly httpPort: number;

  readonly database: {
    readonly url: string;
    readonly poolMin: number;
    readonly poolMax: number;
  };

  readonly aws: {
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    /** Endpoint custom para LocalStack; em produção seria omitido. */
    readonly sqsEndpoint: string;
  };

  readonly sqs: {
    readonly wagerQueueUrl: string;
    readonly wagerDlqUrl: string;
    readonly wagerEventsUrl: string;
  };

  /** Identifica este consumidor no inbox: chave (consumerName, messageId). */
  readonly consumerName: string;
}

function loadEnv(): Env {
  const nodeEnv = (process.env['NODE_ENV'] ?? 'development') as Env['nodeEnv'];

  return Object.freeze({
    nodeEnv,
    httpPort: optionalNumber('HTTP_PORT', 3000),

    database: Object.freeze({
      url: required('DATABASE_URL'),
      poolMin: optionalNumber('DB_POOL_MIN', 2),
      poolMax: optionalNumber('DB_POOL_MAX', 10),
    }),

    aws: Object.freeze({
      region: process.env['AWS_REGION'] ?? 'us-east-1',
      accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? 'test',
      secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? 'test',
      sqsEndpoint: required('SQS_ENDPOINT'),
    }),

    sqs: Object.freeze({
      wagerQueueUrl: required('SQS_WAGER_QUEUE_URL'),
      wagerDlqUrl: required('SQS_WAGER_DLQ_URL'),
      wagerEventsUrl: required('SQS_WAGER_EVENTS_URL'),
    }),

    consumerName: process.env['CONSUMER_NAME'] ?? 'wager-processor',
  });
}

export const env: Env = loadEnv();
