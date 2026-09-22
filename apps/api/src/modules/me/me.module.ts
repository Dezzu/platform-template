import { Module } from '@nestjs/common';
import { FlagsModule } from '../flags/flags.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

/**
 * Imports the two platform-state modules because /me is the single call the shell
 * makes on boot: who you are, what you may do, what is switched on, and whether the
 * product is open. Four round trips would be four chances for the interface to render
 * half a truth.
 */
@Module({
  imports: [FlagsModule, MaintenanceModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
