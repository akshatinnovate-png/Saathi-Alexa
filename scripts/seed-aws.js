import { config } from '../src/config.js';
import { createDynamoStore } from '../src/aws/dynamoStore.js';

const store = createDynamoStore({ tableName: config.resources.tableName, region: config.region });
await store.reset();
console.log(`Seeded ${config.resources.tableName} in ${config.region}`);
