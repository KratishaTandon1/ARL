import fs from 'fs';
import path from 'path';
import { db } from './db';

async function init() {
  try {
    console.log('Reading schema.sql...');
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema...');
    await db.query(schema);
    
    console.log('Database initialized successfully!');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

init();
