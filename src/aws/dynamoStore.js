import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, BatchWriteCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { seedData } from '../domain/seed.js';

export function createDynamoStore({ tableName, region, client } = {}) {
  const doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const strip = (item) => {
    if (!item) return null;
    const { pk, sk, ...rest } = item;
    return rest;
  };

  return {
    kind: 'dynamodb',
    async list(collection) {
      const items = [];
      let ExclusiveStartKey;
      do {
        const out = await doc.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': collection },
          ExclusiveStartKey,
        }));
        items.push(...(out.Items ?? []).map(strip));
        ExclusiveStartKey = out.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },
    async get(collection, id) {
      const out = await doc.send(new GetCommand({ TableName: tableName, Key: { pk: collection, sk: id } }));
      return strip(out.Item);
    },
    async put(collection, item) {
      await doc.send(new PutCommand({ TableName: tableName, Item: { pk: collection, sk: item.id, ...item } }));
      return item;
    },
    async update(collection, id, patch) {
      const keys = Object.keys(patch);
      if (!keys.length) return this.get(collection, id);
      const out = await doc.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: collection, sk: id },
        UpdateExpression: `SET ${keys.map((k, i) => `#k${i} = :v${i}`).join(', ')}`,
        ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#k${i}`, k])),
        ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:v${i}`, patch[k]])),
        ConditionExpression: 'attribute_exists(pk)',
        ReturnValues: 'ALL_NEW',
      })).catch((err) => {
        if (err.name === 'ConditionalCheckFailedException') return { Attributes: null };
        throw err;
      });
      return strip(out.Attributes);
    },
    async remove(collection, id) {
      await doc.send(new DeleteCommand({ TableName: tableName, Key: { pk: collection, sk: id } }));
      return true;
    },
    async reset() {
      const data = seedData();
      const writes = Object.entries(data).flatMap(([collection, items]) =>
        items.map((item) => ({ PutRequest: { Item: { pk: collection, sk: item.id, ...item } } })));
      for (let i = 0; i < writes.length; i += 25) {
        await doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: writes.slice(i, i + 25) } }));
      }
    },
  };
}
