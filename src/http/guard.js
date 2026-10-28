import { decide, coreCatalog } from '../security/core.js';

const PUBLIC = [
  ['GET', /^\/session$/],
  ['GET', /^\/reference$/],
  ['GET', /^\/invite\/[^/]+$/],
];

export const API_ROUTES = [
  ['GET', /^\/status$/, 'status'],
  ['GET', /^\/family\/summary$/, 'summary'],
  ['GET', /^\/family\/messages$/, 'messages.read'],
  ['POST', /^\/family\/message$/, 'messages.send'],
  ['POST', /^\/family\/voice-note$/, 'messages.voice'],
  ['POST', /^\/family\/alerts\/[^/]+\/ack$/, 'alerts.ack'],
  ['GET', /^\/family\/door$/, 'door.read'],
  ['GET', /^\/home$/, 'home.read'],
  ['GET', /^\/events$/, 'events'],
  ['POST', /^\/alexa\/(turn|answer|reset)$/, 'alexa.turn'],
  ['POST', /^\/assistant$/, 'assistant'],
  ['POST', /^\/speak$/, 'speak'],
  ['POST', /^\/demo\/(reset|sweep)$/, 'demo.reset'],
  ['POST', /^\/ring\/simulate$/, 'ring.simulate'],
  ['POST', /^\/family\/refill$/, 'care.refill'],
  ['POST', /^\/family\/escort$/, 'care.escort'],
  ['POST', /^\/family\/letter$/, 'letter'],
  ['PUT', /^\/home\/rooms$/, 'home.edit'],
  ['POST', /^\/home\/items$/, 'home.edit'],
  ['DELETE', /^\/home\/items\/[^/]+$/, 'home.edit'],
  ['POST', /^\/family\/avatar$/, 'avatar'],
  ['POST', /^\/devices\/pairing-code$/, 'devices.pair'],
  ['GET', /^\/devices\/requests$/, 'devices.requests'],
  ['POST', /^\/devices\/requests\/[^/]+$/, 'devices.decide'],
  ['GET', /^\/devices$/, 'devices.list'],
  ['DELETE', /^\/devices\/[^/]+$/, 'devices.remove'],
  ['GET', /^\/mail$/, 'mail.status'],
  ['POST', /^\/mail\/test$/, 'mail.test'],
  ['DELETE', /^\/mail\/gmail$/, 'mail.disconnect'],
  ['GET', /^\/care$/, 'care.read'],
  ['POST', /^\/care\/(medications|appointments)$/, 'care.edit'],
  ['PUT', /^\/care\/(medications|appointments)\/[^/]+$/, 'care.edit'],
  ['DELETE', /^\/care\/(medications|appointments)\/[^/]+$/, 'care.edit'],
  ['PUT', /^\/care\/routine$/, 'care.edit'],
  ['GET', /^\/doorbell$/, 'doorbell.read'],
  ['POST', /^\/doorbell\/(hook|ring|ring\/code)$/, 'doorbell.manage'],
  ['DELETE', /^\/doorbell\/ring$/, 'doorbell.manage'],
  ['PUT', /^\/household\/profile$/, 'profile.edit'],
  ['DELETE', /^\/household\/members\/[^/]+$/, 'members.remove'],
  ['GET', /^\/household\/invites$/, 'invites.list'],
  ['POST', /^\/household\/invite$/, 'members.invite'],
  ['POST', /^\/household\/invite\/[^/]+\/resend$/, 'members.resend'],
  ['POST', /^\/household\/device-token$/, 'alexa.key'],
  ['POST', /^\/onboarding$/, 'onboarding'],
  ['GET', /^\/security\/log$/, 'audit.read'],
  ['GET', /^\/vault(\/.*)?$/, 'vault.keys'],
  ['POST', /^\/vault\/rotate$/, 'vault.rotate'],
  ['POST', /^\/vault(\/.*)?$/, 'vault.keys'],
  ['PUT', /^\/vault(\/.*)?$/, 'vault.keys'],
  ['GET', /^\/security(\/.*)?$/, 'security.self'],
  ['POST', /^\/security(\/.*)?$/, 'security.self'],
  ['DELETE', /^\/security(\/.*)?$/, 'security.self'],
];

const MESSAGES = {
  'not-signed-in': 'Please log in.',
  'needs-account': 'Please log in.',
  'no-household': 'Set up your household first.',
  'other-household': 'That belongs to another family.',
  'device-cannot': "This device can't do that. Use the family app.",
  'neighbour-cannot': 'Neighbours can see alerts, but not this part of Saathi.',
  'owner-only': 'Only the person who set up this household can do that.',
};

const known = new Set(coreCatalog().actions.map((a) => a.name));
for (const [, , action] of API_ROUTES) {
  if (!known.has(action)) throw new Error(`Route action ${action} is not defined in saathi-core`);
}

export function routeFor(method, path) {
  const m = method === 'HEAD' ? 'GET' : method;
  if (PUBLIC.some(([pm, re]) => pm === m && re.test(path))) return { public: true };
  const hit = API_ROUTES.find(([rm, re]) => rm === m && re.test(path));
  return hit ? { action: hit[2] } : null;
}

export function apiGuard({ requireLogin, defaultHousehold, services, audit = null }) {
  return async (req, res, next) => {
    try {
      const route = routeFor(req.method, req.path);
      if (!route) return res.status(404).json({ error: 'Not found.' });
      if (route.public) return next();
      let principal;
      if (req.user) {
        let role = req.user.role === 'owner' ? 'owner' : req.user.householdId ? 'member' : null;
        if (role === 'member' && req.user.memberId) {
          const me = (await services.forHousehold(req.user.householdId).circle()).find((p) => p.id === req.user.memberId);
          if (me?.role === 'neighbour') role = 'neighbour';
        }
        principal = { kind: 'user', household: req.user.householdId ?? null, role };
      } else if (req.device) {
        principal = { kind: 'device', household: req.device.householdId };
      } else if (!requireLogin) {
        principal = { kind: 'open', household: defaultHousehold };
      } else {
        principal = { kind: 'anonymous' };
      }
      const verdict = decide({ principal, action: route.action, household: principal.household ?? '' });
      if (!verdict.ok) {
        if (verdict.code !== 'not-signed-in' && audit) {
          audit.append({ householdId: principal.household ?? null, actor: req.user?.email ?? req.device?.id ?? null, action: 'access-denied', detail: { action: route.action, why: verdict.code }, ip: req.ip }).catch(() => {});
        }
        return res.status(verdict.status).json({ error: MESSAGES[verdict.code] ?? 'Not allowed.', code: verdict.code });
      }
      req.action = route.action;
      req.role = principal.role ?? null;
      next();
    } catch (err) {
      next(err);
    }
  };
}
