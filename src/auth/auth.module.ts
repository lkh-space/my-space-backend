import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { RemoteUserGuard } from '../common/guards/remote-user.guard.js';

@Module({
  controllers: [AuthController],
  providers: [RemoteUserGuard],
  exports: [RemoteUserGuard],
})
export class AuthModule {}
