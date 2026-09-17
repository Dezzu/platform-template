import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { MembersController } from './members.controller';
import { MembersRepository } from './members.repository';
import { MembersService } from './members.service';

@Module({
  controllers: [MembersController, InvitationsController],
  providers: [MembersService, MembersRepository],
})
export class MembersModule {}
