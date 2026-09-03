import { SQSClient } from '@aws-sdk/client-sqs';
import { env } from '@config/env';

/** Token de injeção para o cliente SQS. */
export const SQS_CLIENT = Symbol('SQS_CLIENT');

export function createSqsClient(): SQSClient {
  return new SQSClient({
    region: env.aws.region,
    endpoint: env.aws.sqsEndpoint,
    credentials: {
      accessKeyId: env.aws.accessKeyId,
      secretAccessKey: env.aws.secretAccessKey,
    },
  });
}
