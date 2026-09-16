import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { PlanListQuerySchema, PlanSchema, type Plan, type PlanListQuery } from '@app/contracts';
import { ApiEnvelope } from '../../common';
import { PlansService } from './plans.service';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /**
   * Public on purpose: the marketing site renders pricing without a session.
   * `@Query({ schema })` is NestJS 12 validating a Standard Schema natively — no DTO
   * classes, no nestjs-zod, and the same schema the Angular client imports its types from.
   */
  @Get()
  @AllowAnonymous()
  @ApiOperation({ summary: 'List the public plan catalogue' })
  @ApiEnvelope(PlanSchema, { isArray: true })
  list(@Query({ schema: PlanListQuerySchema }) query: PlanListQuery): Promise<Plan[]> {
    return this.plans.list(query.includeInactive);
  }
}
