import { randomUUID } from 'node:crypto';

const ALIVE_MS = 20_000;
const KEEP_MS = 24 * 3600 * 1000;
const STATUSES = new Set(['working', 'done', 'failed']);
const LOCAL_ADDRESS = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const FORWARD_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip'];

export function onThisComputer(req, { exposed = false } = {}) {
  if (exposed) return false;
  if (!LOCAL_ADDRESS.test(String(req.socket?.remoteAddress ?? ''))) return false;
  return !FORWARD_HEADERS.some((h) => req.headers?.[h] !== undefined);
}

export function createSahayQueue({ clock = () => Date.now() } = {}) {
  const tasks = new Map();
  let lastPoll = 0;

  const prune = () => {
    for (const [id, t] of tasks) if (clock() - t.createdAt > KEEP_MS) tasks.delete(id);
  };
  const view = (t) => ({ id: t.id, instruction: t.instruction, original: t.original, language: t.language, status: t.status, note: t.note, requestedBy: t.requestedBy, createdAt: new Date(t.createdAt).toISOString(), updatedAt: new Date(t.updatedAt).toISOString() });

  return {
    alive: () => clock() - lastPoll < ALIVE_MS,

    enqueue({ householdId, instruction, language = 'en', requestedBy = null, original = null }) {
      prune();
      const text = String(instruction ?? '').trim().slice(0, 600);
      if (!text) throw Object.assign(new Error('Tell Sahay what to do.'), { status: 400 });
      const at = clock();
      const task = { id: randomUUID(), householdId, instruction: text, original: original ? String(original).slice(0, 600) : null, language, requestedBy, status: 'queued', note: null, createdAt: at, updatedAt: at };
      tasks.set(task.id, task);
      return view(task);
    },

    next() {
      lastPoll = clock();
      prune();
      const task = [...tasks.values()].filter((t) => t.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!task) return null;
      task.status = 'sent';
      task.updatedAt = clock();
      return { id: task.id, instruction: task.instruction, original: task.original, language: task.language };
    },

    update(id, { status, note }) {
      const task = tasks.get(String(id));
      if (!task) return null;
      if (!STATUSES.has(status)) throw Object.assign(new Error('status must be working, done or failed'), { status: 400 });
      task.status = status;
      task.note = note ? String(note).slice(0, 500) : task.note;
      task.updatedAt = clock();
      return view(task);
    },

    list(householdId) {
      prune();
      return [...tasks.values()].filter((t) => t.householdId === householdId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map(view);
    },
  };
}
