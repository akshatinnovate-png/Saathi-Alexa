import { loadDefinition, runStateMachine } from './interpreter.js';

export function createLocalEscalation({ store, notifier, bus, sleep }) {
  const definition = loadDefinition({ TableName: 'local', FamilyTopicArn: 'local' });

  const tasks = {
    'arn:aws:states:::sns:publish': async (p) => {
      const id = await notifier.notify({
        audience: p.MessageAttributes?.audience?.StringValue ?? 'family',
        severity: p.MessageAttributes?.severity?.StringValue ?? 'info',
        subject: p.Subject,
        message: p.Message,
      });
      return { MessageId: id };
    },
    'arn:aws:states:::dynamodb:getItem': async (p) => {
      const item = await store.get('alerts', p.Key.sk.S);
      if (!item) return {};
      return { Item: { acknowledged: { BOOL: Boolean(item.acknowledged) }, escalationStage: { S: item.escalationStage ?? '' } } };
    },
    'arn:aws:states:::dynamodb:updateItem': async (p) => {
      const patch = {};
      for (const assignment of p.UpdateExpression.replace(/^SET\s+/i, '').split(',')) {
        const [attr, placeholder] = assignment.split('=').map((s) => s.trim());
        const v = p.ExpressionAttributeValues[placeholder];
        patch[attr] = v.S ?? v.BOOL ?? (v.N !== undefined ? Number(v.N) : undefined);
      }
      await store.update('alerts', p.Key.sk.S, patch);
      return {};
    },
  };

  const running = new Map();
  return {
    kind: 'local-asl-interpreter',
    definition,
    async start(input) {
      const executionArn = `local:escalation-${input.alertId}`;
      const execution = runStateMachine(definition, input, {
        tasks,
        sleep,
        onTransition: ({ state }) => bus.publish('EscalationStep', { alertId: input.alertId, state }),
      }).then(
        (result) => bus.publish('EscalationFinished', { alertId: input.alertId, status: result.status, path: result.history }),
        (err) => bus.publish('EscalationFinished', { alertId: input.alertId, status: 'FAILED', error: err.message }),
      ).finally(() => running.delete(input.alertId));
      running.set(input.alertId, execution);
      return executionArn;
    },
    wait: (alertId) => running.get(alertId),
  };
}
