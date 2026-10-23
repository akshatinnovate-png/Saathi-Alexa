import { readFileSync } from 'node:fs';

export function loadDefinition(substitutions = {}) {
  const raw = readFileSync(new URL('./escalation.asl.json', import.meta.url), 'utf8');
  return JSON.parse(raw.replace(/\$\{(\w+)\}/g, (_, k) => substitutions[k] ?? `\${${k}}`));
}

export function getPath(obj, path) {
  if (path === '$') return obj;
  if (!path.startsWith('$.')) throw new Error(`Unsupported JSONPath ${path}`);
  let cur = obj;
  for (const key of path.slice(2).split('.')) {
    if (cur === null || typeof cur !== 'object' || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function setPath(obj, path, value) {
  if (path === null) return obj;
  if (path === '$' || path === undefined) return value;
  const out = structuredClone(obj);
  const keys = path.slice(2).split('.');
  let cur = out;
  for (const key of keys.slice(0, -1)) cur = cur[key] ??= {};
  cur[keys.at(-1)] = value;
  return out;
}

export function resolveParameters(template, input) {
  if (Array.isArray(template)) return template.map((t) => resolveParameters(t, input));
  if (template === null || typeof template !== 'object') return template;
  const out = {};
  for (const [key, value] of Object.entries(template)) {
    if (key.endsWith('.$')) out[key.slice(0, -2)] = getPath(input, value);
    else out[key] = resolveParameters(value, input);
  }
  return out;
}

function evaluateRule(rule, input) {
  if (rule.And) return rule.And.every((r) => evaluateRule(r, input));
  if (rule.Or) return rule.Or.some((r) => evaluateRule(r, input));
  if (rule.Not) return !evaluateRule(rule.Not, input);
  const value = getPath(input, rule.Variable);
  if ('IsPresent' in rule) return (value !== undefined) === rule.IsPresent;
  if ('BooleanEquals' in rule) return value === rule.BooleanEquals;
  if ('StringEquals' in rule) return value === rule.StringEquals;
  if ('NumericGreaterThan' in rule) return value > rule.NumericGreaterThan;
  throw new Error(`Unsupported Choice rule ${JSON.stringify(rule)}`);
}

export async function runStateMachine(definition, input, { tasks, sleep = defaultSleep, onTransition = () => {} }) {
  let stateName = definition.StartAt;
  let data = structuredClone(input);
  const history = [];
  for (let steps = 0; steps < 1000; steps++) {
    const state = definition.States[stateName];
    if (!state) throw new Error(`Unknown state ${stateName}`);
    history.push(stateName);
    await onTransition({ state: stateName, type: state.Type, input: data });

    switch (state.Type) {
      case 'Task': {
        const handler = tasks[state.Resource];
        if (!handler) throw new Error(`No local handler for ${state.Resource}`);
        const params = resolveParameters(state.Parameters ?? {}, data);
        const result = await withRetry(() => handler(params), state.Retry, sleep);
        data = setPath(data, state.ResultPath, result);
        break;
      }
      case 'Wait': {
        const seconds = state.Seconds ?? getPath(data, state.SecondsPath);
        await sleep(seconds * 1000);
        break;
      }
      case 'Choice': {
        const match = state.Choices.find((c) => evaluateRule(c, data));
        stateName = match ? match.Next : state.Default;
        if (!stateName) throw new Error('States.NoChoiceMatched');
        continue;
      }
      case 'Pass':
        if ('Result' in state) data = setPath(data, state.ResultPath ?? '$', state.Result);
        break;
      case 'Succeed':
        return { status: 'SUCCEEDED', output: data, history };
      case 'Fail':
        return { status: 'FAILED', error: state.Error, cause: state.Cause, history };
      default:
        throw new Error(`Unsupported state type ${state.Type}`);
    }
    if (state.End) return { status: 'SUCCEEDED', output: data, history };
    stateName = state.Next;
  }
  throw new Error('State machine exceeded 1000 transitions');
}

async function withRetry(fn, retriers = [], sleep) {
  const retrier = retriers?.find((r) => r.ErrorEquals.includes('States.TaskFailed') || r.ErrorEquals.includes('States.ALL'));
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!retrier || attempt >= retrier.MaxAttempts) throw err;
      await sleep((retrier.IntervalSeconds ?? 1) * 1000 * (retrier.BackoffRate ?? 2) ** attempt);
      attempt++;
    }
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
