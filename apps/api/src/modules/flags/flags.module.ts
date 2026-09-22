import { Module } from '@nestjs/common';
import { FlagsController } from './flags.controller';
import { FlagsService } from './flags.service';

/**
 * Exported because both MeController (which ships the resolved set with the session)
 * and FeatureGuard (registered globally in app.module) need it.
 */
@Module({
  controllers: [FlagsController],
  providers: [FlagsService],
  exports: [FlagsService],
})
export class FlagsModule {}
