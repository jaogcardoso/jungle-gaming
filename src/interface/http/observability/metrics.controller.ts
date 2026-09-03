import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from '../../../infrastructure/observability/metrics.service';

/** `GET /metrics` — formato Prometheus. */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4')
  async scrape(): Promise<string> {
    return this.metrics.render();
  }
}
