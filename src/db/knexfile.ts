import type { Knex } from 'knex';

const config: Knex.Config = {
    client: 'mysql',
    connection: {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'root',
        database: 'apip_seafreight',
    },
    migrations: {
        directory: './migrations',
        extension: 'ts',
        loadExtensions: ['.ts', '.js', '.mjs', '.cjs'],
    },
};

export default config;