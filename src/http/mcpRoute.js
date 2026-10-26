import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { buildMcpServer } from '../mcp/server.js';
import { cognitoOAuthMetadata } from '../auth/verifier.js';
import { ALL_SCOPES } from '../auth/scopes.js';
import { DEFAULT_HOUSEHOLD } from '../households/scope.js';

export function mountMcp(app, services, { verifier, optionalVerifier, bus, auth } = {}) {
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
  } else if (optionalVerifier) {
    middleware.push(async (req, res, next) => {
      const header = req.get('authorization') ?? '';
      if (!/^Bearer\s+/i.test(header)) return next();
      try {
        req.auth = await optionalVerifier.verifyAccessToken(header.replace(/^Bearer\s+/i, ''));
        next();
      } catch {
        res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unknown token' }, id: null });
      }
    });
  }

  const householdOf = (req) => req.auth?.extra?.householdId ?? DEFAULT_HOUSEHOLD;

  app.post('/mcp', ...middleware, async (req, res) => {
    const sessionId = req.get('mcp-session-id');
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    if (entry && entry.householdId !== householdOf(req)) {
      return res.status(403).json({ jsonrpc: '2.0', error: { code: -32003, message: 'Session belongs to another household' }, id: null });
    }
    if (!entry) {
      if (sessionId || !isInitializeRequest(req.body)) {
        return res.status(sessionId ? 404 : 400).json({
          jsonrpc: '2.0', error: { code: -32000, message: sessionId ? 'Session not found' : 'First request must be initialize' }, id: null,
        });
      }
      const householdId = householdOf(req);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, { transport, householdId }),
      });
      transport.onclose = () => transport.sessionId && sessions.delete(transport.sessionId);
      await buildMcpServer(services.forHousehold(householdId), { bus }).connect(transport);
      entry = { transport, householdId };
    }
    await entry.transport.handleRequest(req, res, req.body);
  });

  const sessionRequest = async (req, res) => {
    const entry = sessions.get(req.get('mcp-session-id') ?? '');
    if (!entry) return res.status(404).send('Session not found');
    if (entry.householdId !== householdOf(req)) return res.status(403).send('Session belongs to another household');
    await entry.transport.handleRequest(req, res);
  };
  app.get('/mcp', ...middleware, sessionRequest);
  app.delete('/mcp', ...middleware, sessionRequest);

  return { sessions };
}
