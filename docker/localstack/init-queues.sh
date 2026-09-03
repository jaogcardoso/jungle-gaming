#!/bin/bash
# Executado pelo LocalStack quando o serviço fica pronto
# (/etc/localstack/init/ready.d/). Cria as filas exigidas pela seção 10 do
# desafio: a fila FIFO principal e sua DLQ, com RedrivePolicy ligando as duas.
set -euo pipefail

MAIN_QUEUE="wager-transactions.fifo"
DLQ_QUEUE="wager-transactions-dlq.fifo"

echo "[init-queues] criando ${DLQ_QUEUE}"
awslocal sqs create-queue \
  --queue-name "${DLQ_QUEUE}" \
  --attributes FifoQueue=true

DLQ_ARN="$(awslocal sqs get-queue-attributes \
  --queue-url "http://localhost:4566/000000000000/${DLQ_QUEUE}" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)"

cat > /tmp/wager-attrs.json <<EOF
{
  "FifoQueue": "true",
  "ContentBasedDeduplication": "true",
  "VisibilityTimeout": "30",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"
}
EOF

echo "[init-queues] criando ${MAIN_QUEUE} (DLQ=${DLQ_ARN}, maxReceiveCount=5)"
awslocal sqs create-queue \
  --queue-name "${MAIN_QUEUE}" \
  --attributes file:///tmp/wager-attrs.json

# Fila de saída dos eventos de integração publicados pelo outbox worker (Etapa 10).
echo "[init-queues] criando wager-events.fifo"
awslocal sqs create-queue \
  --queue-name "wager-events.fifo" \
  --attributes FifoQueue=true,ContentBasedDeduplication=false

echo "[init-queues] filas disponíveis:"
awslocal sqs list-queues
