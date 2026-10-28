import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { LANGUAGE_CODES } from '../domain/languages.js';
import { TOOL_SCOPES } from '../auth/scopes.js';
import { mayCallTool } from '../security/core.js';
import { t } from '../domain/i18n.js';

export const SERVER_INFO = { name: 'saathi', title: 'Saathi - a companion for elders and the families who love them', version: '2.0.0' };

export const INSTRUCTIONS = `Saathi supports an older adult (read saathi://elder/profile for their name, languages and accessibility needs) and their care circle.
Speak in short, warm sentences, one idea at a time, in the language they used. Never correct or quiz their memory; gently orient instead (use what_day_is_it and who_is).
If they mention a fall, pain, breathlessness, bleeding or being lost, call ask_family_for_help immediately, then stay with them.
Ordinary sadness or loneliness goes through daily_check_in, which nudges the family without alarming anyone. If they ask you to keep something between you, pass keep_private: true; danger always overrides privacy.
Every tool returns a "say" line written for them; you may rephrase it, but keep it kind and simple.
Family members can also use this server from their own Alexa+ devices (family_summary, acknowledge_alert) with the saathi/family scope.`;

const STORY_THEMES = ['childhood', 'wedding', 'festivals', 'cooking', 'school days', 'monsoon', 'first home', 'your children', 'music', 'travel'];

const RESOURCE_EVENTS = {
  'saathi://home': ['HomeMapUpdated', 'HomeItemPlaced', 'HomeItemRemoved', 'DemoReset'],
  'saathi://today': ['DoseTaken', 'DoseMissed', 'CheckInRecorded', 'HelpRequested', 'AlertAcknowledged', 'DoorActivity', 'QuietDay', 'DemoReset'],
  'saathi://circle': ['DemoReset'],
};

const lang = z.enum(LANGUAGE_CODES).optional().describe('ISO code of the language they spoke, e.g. "mr" Marathi, "hi" Hindi, "en" English. The "say" line comes back in it.');
const say = z.string().describe('A short, kind sentence to speak to them');
const sayLanguage = z.string().optional().describe('Language of the say line');

const reply = (data) => ({
  content: [{ type: 'text', text: data.say ?? data.text ?? 'Done.' }, { type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});

const forbidden = (tool) => ({
  isError: true,
  content: [{ type: 'text', text: `This device isn't allowed to use ${tool}. It needs the ${TOOL_SCOPES[tool]} scope.` }],
});

export function buildMcpServer(saathi, { bus } = {}) {
  const server = new McpServer(SERVER_INFO, {
    instructions: INSTRUCTIONS,
    capabilities: { logging: {}, resources: { subscribe: Boolean(bus), listChanged: Boolean(bus) }, completions: {} },
  });

  const notSetUp = { content: [{ type: 'text', text: "Saathi isn't set up for this home yet. Ask the family to finish setting it up in the Saathi app." }], isError: true };
  const tool = (name, config, handler) => server.registerTool(name, config, async (args, extra) => {
    if (!mayCallTool({ scopes: extra.authInfo ? extra.authInfo.scopes ?? [] : null, tool: name })) return forbidden(name);
    if (!(await saathi.elder())) return notSetUp;
    return handler(args, extra);
  });

  tool('what_day_is_it', {
    title: 'Gentle orientation',
    description: 'Tells them the day, date, time, where they are and what comes next in their routine. Use whenever they seem unsure of the day or time, or ask "what should I do now?".',
    inputSchema: { language: lang },
    outputSchema: {
      say, sayLanguage, today: z.string(), time: z.string(), partOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']), place: z.string(), greetingName: z.string(),
      next: z.object({ time: z.string(), activity: z.string() }).loose().nullable(),
      laterToday: z.array(z.object({ time: z.string(), activity: z.string() }).loose()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ language }) => reply(await saathi.orientation({ language })));

  tool('who_is', {
    title: 'Who is this person?',
    description: 'Explains who someone in their circle is (by name or relationship, in English, Hindi or Marathi, e.g. "Maya", "my granddaughter", "नात"), with their last message and regular plans. A memory aid; never imply they should have remembered.',
    inputSchema: { person: z.string().min(1).describe('Name or relationship'), language: lang },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ person, language }) => reply(await saathi.whoIs(person, { language })));

  tool('get_medication_schedule', {
    title: "Today's tablets",
    description: "Lists today's medications with status (taken, due, missed, upcoming), described by look and purpose so they are easy to identify.",
    inputSchema: { language: lang },
    outputSchema: {
      say, sayLanguage,
      medications: z.array(z.object({
        id: z.string(), name: z.string(), purpose: z.string(), time: z.string(), description: z.string(),
        status: z.enum(['taken', 'due', 'missed', 'upcoming']), takenAt: z.string().nullable(),
      }).loose()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ language }) => reply(await saathi.medicationSchedule({ language })));

  tool('confirm_medication_taken', {
    title: 'I took my tablet',
    description: 'Records that they took a tablet. If they do not say which, the one currently due is used. Prevents double doses by reporting if it was already taken today.',
    inputSchema: { medication: z.string().optional().describe('Name, purpose ("blood pressure", "रक्तदाब") or colour of the tablet'), language: lang },
    outputSchema: { say, sayLanguage, recorded: z.boolean(), alreadyTaken: z.boolean().optional(), medication: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ medication, language }) => reply(await saathi.confirmMedication(medication, { language })));

  tool('daily_check_in', {
    title: 'How are you feeling?',
    description: 'Records how they say they feel, in their own words and language. Sentiment and a safety screen run on it; loneliness or low mood gently nudges the family (unless they ask to keep it private), and danger words always start the escalation workflow.',
    inputSchema: {
      how_i_feel: z.string().min(1).describe('Their words, verbatim'),
      language: lang,
      keep_private: z.boolean().default(false).describe('True if they asked not to tell their family. Never suppresses an emergency.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ how_i_feel, language, keep_private }) => reply(await saathi.checkIn({ text: how_i_feel, language, keepPrivate: keep_private })));

  tool('ask_family_for_help', {
    title: 'Call for help',
    description: 'Starts the care-circle escalation: family is alerted first, then the neighbour if nobody responds, then emergency guidance to everyone. Use for falls, pain, breathlessness, being lost, or whenever they ask for help. Safe to retry: repeated calls join the open alert.',
    inputSchema: {
      reason: z.string().min(1).describe('What is happening, in a few words'),
      urgency: z.enum(['high', 'critical']).default('high'),
      language: lang,
    },
    outputSchema: { say, sayLanguage, alertId: z.string(), deduplicated: z.boolean().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ reason, urgency, language }) => reply(await saathi.requestHelp({ reason, urgency, language })));

  tool('get_family_messages', {
    title: 'Messages from family',
    description: 'Reads new messages from their family, translated into their language whatever language they were written in.',
    inputSchema: { include_already_heard: z.boolean().default(false), language: lang },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ include_already_heard, language }) => reply(await saathi.familyMessages({ unreadOnly: !include_already_heard, language })));

  tool('send_message_to_family', {
    title: 'Send a message',
    description: 'Sends their spoken message to family. Each person receives it translated into their own language. If the device supports it, they are asked to confirm before anything is sent.',
    inputSchema: {
      message: z.string().min(1).describe('Their words, verbatim'),
      to: z.string().optional().describe('Name or relationship; omit for the whole family'),
      language: lang,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ message, to, language }) => {
    const spoken = language ?? (await saathi.elder()).language;
    if (server.server.getClientCapabilities()?.elicitation) {
      const answer = await server.server.elicitInput({
        mode: 'form',
        message: t(spoken, 'confirmSend', { to, message }),
        requestedSchema: {
          type: 'object',
          properties: { send: { type: 'boolean', title: 'Send it?', description: 'Yes to send, no to keep it' } },
          required: ['send'],
        },
      });
      if (answer.action !== 'accept' || !answer.content?.send) {
        return reply({ sent: false, say: t(spoken, 'notSent') });
      }
    }
    return reply(await saathi.sendToFamily({ text: message, to, language }));
  });

  tool('save_memory_story', {
    title: 'Save a memory',
    description: 'Saves a story or memory they tell into their memory book, translated into every family language and narrated, so grandchildren who speak other languages can hear it. Reports progress while it translates and narrates.',
    inputSchema: {
      story: z.string().min(1).describe('The story in their own words'),
      title: z.string().optional().describe('A short title, e.g. "Monsoon wedding, 1968"'),
      language: lang,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ story, title, language }, extra) => {
    const progressToken = extra._meta?.progressToken;
    const onProgress = progressToken === undefined ? undefined : (progress, total, message) =>
      extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress, total, message } });
    return reply(await saathi.saveStory({ text: story, title, language, onProgress }));
  });

  tool('list_memory_stories', {
    title: 'Memory book',
    description: 'Lists the stories in their memory book (most recent first) so they can be retold. Each story is also a resource at saathi://stories/{storyId}.',
    inputSchema: { limit: z.number().int().min(1).max(20).default(5), language: lang },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit, language }) => {
    const spoken = language ?? (await saathi.elder()).language;
    const stories = (await saathi.listStories()).slice(0, limit).map((s) => ({ id: s.id, uri: `saathi://stories/${s.id}`, title: s.title, text: s.text, english: s.translations.en?.text, createdAt: s.createdAt }));
    return reply({ stories, say: stories.length ? t(spoken, 'storyCount', { count: stories.length, title: stories[0].title }) : t(spoken, 'storyNone') });
  });

  tool('get_upcoming_appointments', {
    title: 'Doctor visits',
    description: 'Tells them about upcoming doctor visits: when, where, with whom, and who in the family is taking them.',
    inputSchema: { days: z.number().int().min(0).max(60).default(14), language: lang },
    outputSchema: {
      say, sayLanguage,
      appointments: z.array(z.object({ id: z.string(), title: z.string(), with: z.string(), place: z.string(), at: z.string(), daysAway: z.number(), escort: z.string().nullable(), escortName: z.string().nullable() }).loose()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ days, language }) => reply(await saathi.upcomingAppointments({ days, language })));

  tool('record_refill', {
    title: 'Tablets refilled (family)',
    description: 'For a family member: records that a medicine was refilled, which closes the low-supply alert and tells them it is taken care of.',
    inputSchema: { medication_id: z.string(), quantity: z.number().int().min(1).max(365).default(30), member: z.string().describe('Family member id, from saathi://circle, e.g. "maya"') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ medication_id, quantity, member }) => {
    const r = await saathi.recordRefill({ medicationId: medication_id, quantity, by: member });
    return reply(r ? { ...r, say: `Thank you. ${(await saathi.elder()).preferredName} now has ${r.daysLeft} days of it, and has been told.` } : { say: 'I could not find that medicine.' });
  });

  tool('claim_appointment_escort', {
    title: "I'll take them (family)",
    description: 'For a family member: volunteers to take them to a doctor visit. They are told, in their language, who is coming.',
    inputSchema: { appointment_id: z.string(), member: z.string().describe('Family member id, e.g. "anand"') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ appointment_id, member }) => {
    const appt = await saathi.claimEscort({ appointmentId: appointment_id, member });
    return reply(appt ? { claimed: true, appointment: appt.id, say: `Thank you. ${(await saathi.elder()).preferredName} knows you're coming to ${appt.with}.` } : { claimed: false, say: 'I could not find that visit.' });
  });

  tool('weekly_family_letter', {
    title: "This week's letter (family)",
    description: "For a family member: this week's letter about them (tablets, mood, stories, front door, alerts, upcoming visits), in the member's language. Private check-ins are only counted, never quoted.",
    inputSchema: { member: z.string().describe('Family member id, from saathi://circle, e.g. "maya"') },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ member }) => {
    const letter = (await saathi.weeklyLetters({ send: false })).find((l) => l.memberId === member);
    return reply(letter ? { say: letter.text, english: letter.english } : { say: 'I could not find that family member.' });
  });

  tool('where_is', {
    title: 'Where is my…?',
    description: 'Finds where something is usually kept at home (glasses, keys, tablet box, photo album), from the house map the family built. Answers in their language. A memory aid: never imply they should have remembered.',
    inputSchema: { item: z.string().min(1).describe('The thing they are looking for, in any language'), language: lang },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ item, language }) => reply(await saathi.whereIs(item, { language })));

  tool('family_summary', {
    title: 'How are they today? (family)',
    description: "For a family member's Alexa+: today's tablets, mood and open alerts, in that member's language. Private check-ins stay private.",
    inputSchema: { member: z.string().optional().describe('Family member id, from saathi://circle, e.g. "maya"') },
    outputSchema: {
      say, sayLanguage, english: z.string(),
      alerts: z.array(z.object({ id: z.string(), reason: z.string().optional(), severity: z.string(), escalationStage: z.string().optional() }).loose()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ member }) => {
    const s = await saathi.familySummary({ forMemberId: member });
    return reply({ say: s.text, english: s.english, alerts: s.alerts.filter((a) => !a.acknowledged).map(({ id, reason, severity, escalationStage }) => ({ id, reason, severity, escalationStage })) });
  });

  tool('acknowledge_alert', {
    title: "I'm on it (family)",
    description: 'For a family member: acknowledges an alert, which stops the escalation and tells them someone is coming.',
    inputSchema: { alert_id: z.string(), member: z.string().describe('Family member id, from saathi://circle, e.g. "maya"') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ alert_id, member }) => {
    const alert = await saathi.acknowledgeAlert({ alertId: alert_id, by: member });
    return reply(alert ? { acknowledged: true, say: `Thank you. ${(await saathi.elder()).preferredName} has been told you are on your way.` } : { acknowledged: false, say: 'I could not find that alert.' });
  });

  const json = (uri, data) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] });

  server.registerResource('elder-profile', 'saathi://elder/profile', {
    title: 'Elder profile and accessibility needs',
    description: 'Name, languages, home, routine, accessibility preferences (pace, hearing, memory support) and privacy choices.',
    mimeType: 'application/json',
  }, async (uri) => json(uri, await saathi.elder()));

  server.registerResource('care-circle', 'saathi://circle', {
    title: 'Care circle',
    description: 'Family and neighbours, their languages and escalation order.',
    mimeType: 'application/json',
  }, async (uri) => json(uri, await saathi.circle()));

  server.registerResource('today', 'saathi://today', {
    title: 'Today at a glance',
    description: 'Orientation plus medication status for right now. Subscribe to be told when it changes.',
    mimeType: 'application/json',
  }, async (uri) => json(uri, { orientation: await saathi.orientation(), medications: await saathi.medicationStatus() }));

  server.registerResource('home-map', 'saathi://home', {
    title: 'House map',
    description: 'Rooms (floor polygons in metres), where things are kept, and where the Echo and Ring devices are.',
    mimeType: 'application/json',
  }, async (uri) => json(uri, await saathi.homeMap()));

  server.registerResource('story', new ResourceTemplate('saathi://stories/{storyId}', {
    list: async () => ({
      resources: (await saathi.listStories()).map((s) => ({ uri: `saathi://stories/${s.id}`, name: s.title, mimeType: 'application/json', description: `A memory from ${s.createdAt.slice(0, 10)}` })),
    }),
    complete: { storyId: async (value) => (await saathi.listStories()).map((s) => s.id).filter((id) => id.startsWith(value)) },
  }), {
    title: 'A story from the memory book',
    description: 'One story, in their words and every family language, with narration links.',
    mimeType: 'application/json',
  }, async (uri, { storyId }) => {
    const story = (await saathi.listStories()).find((s) => s.id === storyId);
    if (!story) throw new Error(`No story ${storyId}`);
    return json(uri, story);
  });

  server.registerPrompt('gentle_morning_check_in', {
    title: 'Gentle morning check-in',
    description: 'Greets them, orients them to the day, asks how they slept, and reminds them of morning tablets.',
  }, () => ({
    messages: [{ role: 'user', content: { type: 'text', text: 'Start a gentle morning check-in: greet them by their preferred name in their language, use what_day_is_it, ask how they slept and record their answer with daily_check_in, then check get_medication_schedule and get_family_messages. One question at a time.' } }],
  }));

  server.registerPrompt('memory_lane', {
    title: 'Memory lane',
    description: 'Invites them to tell a story from their life and saves it to their memory book.',
    argsSchema: { theme: completable(z.string().describe('What the memory is about'), (value) => STORY_THEMES.filter((t) => t.startsWith(value.toLowerCase()))) },
  }, ({ theme }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Invite them, warmly and without pressure, to share a memory${theme ? ` about ${theme}` : ''}. Listen, ask one gentle follow-up, then save it with save_memory_story and tell them who will get to hear it.` } }],
  }));

  if (bus) attachLiveUpdates(server, bus, saathi.householdId ?? 'default');
  return server;
}

function attachLiveUpdates(server, bus, householdId) {
  const subscriptions = new Set();
  server.server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => { subscriptions.add(params.uri); return {}; });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => { subscriptions.delete(params.uri); return {}; });

  const unsubscribe = bus.subscribe(async (event) => {
    if (!server.isConnected()) return;
    if ((event.detail?.householdId ?? 'default') !== householdId) return;
    const type = event['detail-type'];
    try {
      for (const [uri, types] of Object.entries(RESOURCE_EVENTS)) {
        if (subscriptions.has(uri) && types.includes(type)) await server.server.sendResourceUpdated({ uri });
      }
      if (type === 'StoryShared') await server.sendResourceListChanged();
      if (['HelpRequested', 'EscalationStep', 'EscalationFinished', 'AlertAcknowledged'].includes(type)) {
        await server.sendLoggingMessage({ level: type === 'HelpRequested' ? 'warning' : 'notice', logger: 'escalation', data: { event: type, ...event.detail } });
      }
    } catch {
    }
  });
  const previous = server.server.onclose;
  server.server.onclose = () => { unsubscribe(); previous?.(); };
}
