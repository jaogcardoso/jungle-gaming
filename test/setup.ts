import 'reflect-metadata';

process.env['NODE_ENV'] ??= 'test';

process.env['DATABASE_URL'] ??= 'postgres://jungle:jungle@localhost:5432/jungle';
process.env['SQS_ENDPOINT'] ??= 'http://localhost:4566';
process.env['SQS_WAGER_QUEUE_URL'] ??= 'http://localhost:4566/000000000000/wager-transactions.fifo';
process.env['SQS_WAGER_DLQ_URL'] ??= 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
process.env['SQS_WAGER_EVENTS_URL'] ??= 'http://localhost:4566/000000000000/wager-events.fifo';
