import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createRedisConnection } from '../services/deploy.constants';
import { NodesController } from './nodes.controller';
import { NodeAgentController } from './node-agent.controller';
import { NodesService } from './nodes.service';
import { AgentClient } from './agent.client';
import { AgentTokenService } from './agent-token.service';
import { AgentRunnerService } from './agent-runner.service';
import { DaemonTokenRotationScheduler } from './daemon-token-rotation.scheduler';
import {
  DAEMON_TOKEN_ROTATION_QUEUE,
  DAEMON_TOKEN_ROTATION_QUEUE_NAME,
} from './daemon-token-rotation.constants';

@Module({
  controllers: [NodesController, NodeAgentController],
  providers: [
    NodesService,
    AgentClient,
    AgentTokenService,
    AgentRunnerService,
    DaemonTokenRotationScheduler,
    {
      provide: DAEMON_TOKEN_ROTATION_QUEUE,
      useFactory: () =>
        new Queue(DAEMON_TOKEN_ROTATION_QUEUE_NAME, {
          connection: createRedisConnection(),
        }),
    },
  ],
  exports: [NodesService, AgentClient, AgentTokenService],
})
export class NodesModule {}
