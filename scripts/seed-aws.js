import { config } from '../src/config.js';
import { createDynamoStore } from '../src/aws/dynamoStore.js';
import { seedData } from '../src/domain/seed.js';

if (!process.argv.includes('--demo')) {
  console.error('This writes the fictional demo family (Aaji, Riya, Anand, Meera) into DynamoDB.\nRun it only for a demo deployment: npm run seed:aws -- --demo');
  process.exit(1);
}
const store = createDynamoStore({ tableName: config.resources.tableName, region: config.region });
await store.reset(seedData());
console.log(`Seeded the demo family into ${config.resources.tableName} in ${config.region}`);
