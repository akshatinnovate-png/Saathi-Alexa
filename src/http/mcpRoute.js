import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { buildMcpServer } from '../mcp/server.js';
import { cognitoOAuthMetadata } from '../auth/verifier.js';
import { ALL_SCOPES } from '../auth/scopes.js';

export function mountMcp(app, saathi, { verifier, bus, auth } = {}) {
  const sessions = new Map();
  const middleware = [];

  if (verifier) {
    let resourceMetadataUrl;
    if (auth?.mode === 'cognito' && auth.publicUrl) {
      const resourceServerUrl = new URL('/mcp', auth.publicUrl);
      app.use(mcpAuthMetadataRouter({
        oauthMetadata: cognitoOAuthMetadata(auth),
        resourceServerUrl,
        scopesSupported: ALL_SCOPES,
        resourceName: 'Saathi',
      }));
      resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl);
    }
    middleware.push(requireBearerAuth({ verifier, resourceMetadataUrl }));
  }

  app.post('/mcp', ...middleware, async (req, res) => {
    const sessionId = req.get('mcp-session-id');
    let transport = sessionId ? sessions.get(sessionId) : undefined;

    if (!transport) {
      if (sessionId || !isInitializeRequest(req.body)) {
        return res.status(sessionId ? 404 : 400).json({
          jsonrpc: '2.0', error: { code: -32000, message: sessionId ? 'Session not found' : 'First request must be initialize' }, id: null,
        });
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, transport),
      });
      transport.onclose = () => transport.sessionId && sessions.delete(transport.sessionId);
      await buildMcpServer(saathi, { bus }).connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });

  const sessionRequest = async (req, res) => {
    const transport = sessions.get(req.get('mcp-session-id') ?? '');
    if (!transport) return res.status(404).send('Session not found');
    await transport.handleRequest(req, res);
  };
  app.get('/mcp', ...middleware, sessionRequest);
  app.delete('/mcp', ...middleware, sessionRequest);

  return { sessions };
}
