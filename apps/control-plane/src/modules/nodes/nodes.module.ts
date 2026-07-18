import { Module } from '@nestjs/common';
import { NodesController } from './nodes.controller';
import { NodeAgentController } from './node-agent.controller';
import { NodesService } from './nodes.service';
import { AgentClient } from './agent.client';
import { AgentTokenService } from './agent-token.service';
import { AgentRunnerService } from './agent-runner.service';

@Module({
  controllers: [NodesController, NodeAgentController],
  providers: [NodesService, AgentClient, AgentTokenService, AgentRunnerService],
  exports: [NodesService, AgentClient, AgentTokenService],
})
export class NodesModule {}
