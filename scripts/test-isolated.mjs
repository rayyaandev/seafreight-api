import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql';

dotenv.config();

const host = process.env.DB_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Tests require a local MySQL server; refusing to create a database on a remote host.');
}

const dbName = `codex_test_${process.pid}_${Date.now()}_${randomBytes(4).toString('hex')}`;
const connection = {
    host,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
};
const testEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DB_NAME: dbName,
    ISOLATED_TEST_DB: '1',
    TEST_DB_RUN_NAME: dbName,
};
const bundledBun = join(homedir(), '.bun', 'bin', 'bun');
const bun = process.env.BUN_BIN || (existsSync(bundledBun) ? bundledBun : 'bun');

async function query(sql) {
    const client = mysql.createConnection(connection);
    try {
        await new Promise((resolve, reject) => client.query(sql, [dbName], (error) =>
            error ? reject(error) : resolve()));
    } finally {
        client.end();
    }
}

async function run(command, args) {
    const child = spawn(command, args, { stdio: 'inherit', env: testEnv });
    const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
    });
    if (code !== 0) throw new Error(`${command} exited with code ${code}`);
}

let created = false;
try {
    await query('CREATE DATABASE ??');
    created = true;
    console.log(`Using disposable test database ${dbName}`);
    await run(bun, ['run', 'src/db/migrate.ts']);
    await run(bun, ['run', 'src/db/seeds/01_sea_freight_seed.ts']);
    await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)]);
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    if (created) {
        await query('DROP DATABASE ??');
        console.log(`Removed disposable test database ${dbName}`);
    }
}
