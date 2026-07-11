import { Module } from '@nestjs/common';
import { TunnelsController } from './tunnels.controller';
import { TunnelAssetsController } from './tunnel-assets.controller';
import { TunnelsService } from './tunnels.service';
import { TunnelRunnerService } from './tunnel-runner.service';

@Module({
  controllers: [TunnelsController, TunnelAssetsController],
  providers: [TunnelsService, TunnelRunnerService],
})
export class TunnelsModule {}
