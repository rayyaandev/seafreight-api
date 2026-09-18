import type { Knex } from 'knex';
import dotenv from 'dotenv';
dotenv.config();

const config: Knex.Config = {
    client: 'mysql',
    connection: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'root',
        database: process.env.DB_NAME || 'apip_seafreight',
    },
    migrations: {
        directory: './migrations',
        extension: 'ts',
        loadExtensions: ['.ts', '.js', '.mjs', '.cjs'],
    },
};

export default config;