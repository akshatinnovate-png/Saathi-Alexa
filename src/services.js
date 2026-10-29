import { fileURLToPath } from 'node:url';
import { createFileStore } from './local/fileStore.js';
import { seedData } from './domain/seed.js';
import { createDynamoStore } from './aws/dynamoStore.js';
import { createAwsTranslator, createAwsSentiment, createAwsSpeech } from './aws/language.js';
import { createLocalTranslator, createLocalSentiment, createModelSentiment, createLocalSpeech } from './local/language.js';
import { createAwsEventBus, createAwsNotifier, createAwsMedia, createAwsEscalation } from './aws/platform.js';
import { createLocalEventBus, createLocalNotifier, createLocalMedia } from './local/platform.js';
import { createLocalEscalation } from './escalation/localEscalation.js';
import { createMetrics } from './aws/metrics.js';
import { createSaathi } from './domain/saathi.js';
import { DEFAULT_HOUSEHOLD, isHouseholdId, scopeStore, scopeEvents, scopeNotifier } from './households/scope.js';

export function createServices(config, overrides = {}) {
  const { aws, resources, region } = config;
  const localBus = overrides.localBus ?? createLocalEventBus();
  const metrics = overrides.metrics ?? createMetrics({ enabled: process.env.SAATHI_METRICS !== 'off' });

  const store = overrides.store ?? (aws.dynamodb
    ? createDynamoStore({ tableName: resources.tableName, region })
    : createFileStore({ file: config.dataFile, seed: config.demo ? () => seedData() : () => ({}), key: overrides.storeKey ?? null, keyring: overrides.keyring ?? null }));

  const translator = overrides.translator ?? (aws.translate
    ? createAwsTranslator({ region })
    : createLocalTranslator({ llmTranslate: overrides.llmTranslate }));

  const sentiment = overrides.sentiment ?? (aws.comprehend ? createAwsSentiment({ region, translator }) : overrides.llmMood ? createModelSentiment({ mood: overrides.llmMood }) : createLocalSentiment());
  const speech = overrides.speech ?? (aws.polly ? createAwsSpeech({ region }) : createLocalSpeech());

  const events = overrides.events ?? (aws.eventbridge
    ? createAwsEventBus({ region, eventBusName: resources.eventBusName, local: localBus })
    : localBus);

  const baseNotifier = overrides.notifier ?? (aws.sns
    ? withMirror(createAwsNotifier({ region, topicArn: resources.familyTopicArn }), localBus)
    : createLocalNotifier({ bus: localBus }));
  let emailing = null;
  const notifier = {
    get kind() { return (emailing ?? baseNotifier).kind; },
    notify: (n) => (emailing ?? baseNotifier).notify(n),
    subscribe: (subscription) => baseNotifier.subscribe?.(subscription),
  };
  function attachMail(familyMail) {
    if (!aws.sns) emailing = familyMail.wrapNotifier(baseNotifier);
  }

  const media = overrides.media ?? (aws.s3
    ? createAwsMedia({ region, bucket: resources.mediaBucket })
    : createLocalMedia({ dir: config.mediaDir ?? fileURLToPath(new URL('../data/media', import.meta.url)), signingKey: overrides.mediaSigningKey ?? null, encryptionKey: overrides.mediaEncryptionKey ?? null, keyring: overrides.keyring ?? null }));

  const escalation = overrides.escalation ?? (aws.stepfunctions
    ? createAwsEscalation({ region, stateMachineArn: resources.escalationStateMachineArn })
    : createLocalEscalation({ store, notifier, bus: localBus, sleep: overrides.sleep }));

  if (!aws.eventbridge) {
    localBus.subscribe((event) => {
      if (event['detail-type'] === 'HelpRequested' && !event.mirrorOnly) {
        escalation.start(event.detail.escalation).catch((err) => console.error('escalation failed to start', err));
      }
    });
  }

  const saathi = createSaathi({ store, translator, sentiment, speech, events, notifier, media, metrics, config, clock: overrides.clock, householdId: DEFAULT_HOUSEHOLD });
  const households = new Map([[DEFAULT_HOUSEHOLD, saathi]]);

  function forHousehold(householdId = DEFAULT_HOUSEHOLD) {
    if (!isHouseholdId(householdId)) throw new Error(`Invalid household ${householdId}`);
    if (!households.has(householdId)) {
      households.set(householdId, createSaathi({
        store: scopeStore(store, householdId),
        translator, sentiment, speech, metrics, config, clock: overrides.clock, householdId,
        media: scopeMedia(media, householdId),
        events: scopeEvents(events, householdId),
        notifier: scopeNotifier(notifier, householdId),
      }));
    }
    return households.get(householdId);
  }

  async function resetDemo(seed) {
    for (const [collection, items] of Object.entries(seed)) {
      for (const old of await store.list(collection)) await store.remove(collection, old.id);
      for (const item of items) await store.put(collection, item);
    }
  }

  async function householdIds() {
    return [DEFAULT_HOUSEHOLD, ...(await store.list('households')).map((h) => h.id).filter((id) => id !== DEFAULT_HOUSEHOLD)];
  }

  return {
    saathi, forHousehold, householdIds, resetDemo, attachMail, store, translator, sentiment, speech, events, localBus, notifier, media, escalation, metrics,
    describe: () => ({
      store: store.kind, translate: translator.kind, sentiment: sentiment.kind, speech: speech.kind,
      events: events.kind, notifications: notifier.kind, media: media.kind, escalation: escalation.kind,
    }),
  };
}

function scopeMedia(media, householdId) {
  return {
    ...media,
    kind: media.kind,
    save: (key, body, contentType) => media.save(`${householdId}/${key}`, body, contentType),
    playbackUrl: (ref) => media.playbackUrl?.(ref) ?? ref,
  };
}

function withMirror(notifier, bus) {
  return {
    kind: notifier.kind,
    subscribe: (subscription) => notifier.subscribe(subscription),
    async notify(n) {
      const id = await notifier.notify(n);
      await bus.publish('NotificationSent', { id, ...n }, { mirrorOnly: true });
      return id;
    },
  };
}
