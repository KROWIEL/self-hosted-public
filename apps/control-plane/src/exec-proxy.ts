import type { INestApplication } from '@nestjs/common';
import { MemberRole } from '@selfhosted/shared';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { ServicesService } from './modules/services/services.service';
import { ExecTicketService } from './modules/services/exec-ticket.service';
import { MembersService } from './modules/members/members.service';
import { ProjectResolver } from './modules/members/project-resolver.service';
import { UsersService } from './modules/users/users.service';
import { AgentTokenService } from './modules/nodes/agent-token.service';

const EXEC_PATH = /^\/api\/v1\/services\/([^/]+)\/exec$/;

/**
 * Raw WebSocket proxy for interactive container shells:
 *   browser (single-use ?ticket) ⟷ control plane ⟷ agent (daemon token) ⟷ docker exec.
 * Kept off the Nest gateway layer so we can stream raw PTY frames untouched.
 *
 * Authorization is ticket-based: the browser first POSTs /services/:id/exec-ticket
 * (project-ADMIN checked) to mint a short-lived, single-use ticket, then opens
 * the WS with ?ticket=. Here we atomically burn the ticket, reload the user from
 * the DB and re-check the CURRENT project role — never trusting a token claim.
 */
type LiveSocket = WebSocket & { isAlive?: boolean };

/**
 * Sets up the exec proxy and returns a disposer that tears down all live
 * sessions (used on graceful shutdown).
 */
export function setupExecProxy(app: INestApplication): () => void {
  const server = app.getHttpServer() as Server;
  const services = app.get(ServicesService, { strict: false });
  const agentToken = app.get(AgentTokenService, { strict: false });
  const members = app.get(MembersService, { strict: false });
  const resolver = app.get(ProjectResolver, { strict: false });
  const users = app.get(UsersService, { strict: false });
  const execTickets = app.get(ExecTicketService, { strict: false });
  const wss = new WebSocketServer({ noServer: true });

  // Heartbeat: drop clients that stopped answering (closed tab, dead network)
  // so their upstream docker-exec sessions get cleaned up too.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<LiveSocket>) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 30_000);

  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    const match = EXEC_PATH.exec(url.pathname);
    if (!match) {
      socket.destroy();
      return;
    }

    const serviceId = match[1];
    const ticket = url.searchParams.get('ticket') ?? '';

    // Interactive shell = powerful; require project ADMIN (global admins pass).
    void (async () => {
      try {
        // Atomically burn the single-use ticket; reject if missing/expired/used
        // or if it was minted for a different service.
        const payload = await execTickets.redeem(ticket);
        if (!payload || payload.serviceId !== serviceId) {
          socket.destroy();
          return;
        }

        // Load the user fresh from the DB: deny if the account is gone or its
        // session epoch changed since the ticket was minted (logout/2FA/pw).
        const user = await users.findById(payload.userId);
        if (!user || user.tokenVersion !== payload.tokenVersion) {
          socket.destroy();
          return;
        }

        // Authorize using the CURRENT role from the DB, never a token claim.
        const actor = { id: user.id, role: user.role };
        const projectId = await resolver.resolve('service', serviceId);
        await members.assertRole(actor, projectId, MemberRole.ADMIN);
      } catch {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (client: LiveSocket) => {
        client.isAlive = true;
        client.on('pong', () => {
          client.isAlive = true;
        });
        void bridge(client, serviceId, services, agentToken);
      });
    })();
  });

  return () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) {
      try {
        ws.close(1001, 'server shutting down');
      } catch {
        /* ignore */
      }
    }
    wss.close();
  };
}

async function bridge(
  client: WebSocket,
  serviceId: string,
  services: ServicesService,
  agentToken: AgentTokenService,
): Promise<void> {
  let node: Awaited<ReturnType<ServicesService['getNodeRow']>>;
  try {
    node = await services.getNodeRow(serviceId);
  } catch {
    client.close(1011, 'service not found');
    return;
  }

  const scheme = process.env.AGENT_INSECURE_HTTP === '1' ? 'ws' : 'wss';
  const upstream = new WebSocket(
    `${scheme}://${node.fqdn}:${node.agentPort}/api/servers/${serviceId}/exec`,
    { headers: { Authorization: `Bearer ${agentToken.authToken(node)}` } },
  );

  const queue: Array<[RawData, boolean]> = [];
  let open = false;

  client.on('message', (data, isBinary) => {
    if (open) upstream.send(data, { binary: isBinary });
    else queue.push([data, isBinary]);
  });

  upstream.on('open', () => {
    open = true;
    for (const [data, isBinary] of queue) upstream.send(data, { binary: isBinary });
    queue.length = 0;
  });

  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  const closeClient = () => {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  };
  const closeUpstream = () => {
    try {
      upstream.close();
    } catch {
      /* ignore */
    }
  };

  upstream.on('close', closeClient);
  upstream.on('error', closeClient);
  client.on('close', closeUpstream);
  client.on('error', closeUpstream);
}
