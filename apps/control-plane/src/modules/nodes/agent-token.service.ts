import { Injectable } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { nodes } from '../../db/schema';
import { agentSupportsSignedTokens, signAgentRequestToken } from './agent-token';

type NodeAuthFields = Pick<
  typeof nodes.$inferSelect,
  'id' | 'daemonToken' | 'agentVersion'
>;

/**
 * Produces the Authorization bearer value for a CP->agent request. New agents
 * (>= 0.3.0) receive a short-lived HS256 request token signed with the node's
 * shared secret; older/unknown agents receive the raw daemon token so
 * already-enrolled nodes keep authenticating during and after the upgrade.
 */
@Injectable()
export class AgentTokenService {
  constructor(private readonly crypto: CryptoService) {}

  /** Bearer value (without the "Bearer " prefix) for a request to this node. */
  authToken(node: NodeAuthFields): string {
    const secret = this.crypto.decrypt(node.daemonToken);
    if (agentSupportsSignedTokens(node.agentVersion)) {
      return signAgentRequestToken(secret, node.id);
    }
    return secret;
  }
}
