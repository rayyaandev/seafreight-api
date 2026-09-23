import knex from 'knex';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config();

const database = knex({
    client: 'mysql',
    connection: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'apip_seafreight',
    },
    migrations: {
        directory: fileURLToPath(new URL('../src/db/migrations/', import.meta.url)),
        loadExtensions: ['.ts'],
    },
});

try {
    const [batch, files] = await database.migrate.latest();
    console.log(`Migration batch ${batch}: ${files.length ? files.join(', ') : 'already up to date'}`);
} finally {
    await database.destroy();
}
