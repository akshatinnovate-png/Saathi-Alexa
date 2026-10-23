export const api = async (path, body) => {
  const res = await fetch(`/api${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.status === 204 ? null : res.json();
};

const KEY = 'saathi-settings';
export function loadSettings(defaults) {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...defaults }; }
}
export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {  }
}

export function applyDisplay(settings) {
  const root = document.documentElement;
  root.dataset.large = String(Boolean(settings.large));
  if (settings.contrast) root.dataset.contrast = 'high'; else delete root.dataset.contrast;
}

export function bindToggle(button, settings, key, onChange) {
  const sync = () => button.setAttribute('aria-pressed', String(Boolean(settings[key])));
  sync();
  button.addEventListener('click', () => {
    settings[key] = !settings[key];
    sync();
    saveSettings(settings);
    onChange?.();
  });
}

export function onEvents(handler) {
  let source;
  const connect = () => {
    source = new EventSource('/api/events');
    source.onmessage = (m) => handler(JSON.parse(m.data));
    source.onerror = () => { source.close(); setTimeout(connect, 2000); };
  };
  connect();
}

export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
};

export const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const EVENT_LABELS = {
  CheckInRecorded: 'Check-in recorded',
  WellbeingConcern: 'Gentle nudge to family',
  HelpRequested: 'Help requested',
  EscalationStep: 'Escalation step',
  EscalationFinished: 'Escalation finished',
  AlertAcknowledged: 'Alert acknowledged',
  DoseTaken: 'Tablet taken',
  DoseMissed: 'Tablet not confirmed',
  StoryShared: 'Story saved',
  MessageForElder: 'Message for Aaji',
  MessageFromElder: 'Message from Aaji',
  NotificationSent: 'Notification',
  DemoReset: 'Demo reset',
  DoorActivity: 'Front door (Ring)',
  QuietDay: 'Quiet morning',
  McpProgress: 'MCP progress',
  McpLog: 'MCP log',
  McpResourceUpdated: 'MCP resource updated',
  McpResourceListChanged: 'MCP resource list changed',
};
