import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService, type ReadinessResult } from './health.service';

/** Endpoints de health — abertos, sem autenticação (requisito da seção 2/9 do desafio). */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResult> {
    const result = await this.health.checkReadiness();
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
