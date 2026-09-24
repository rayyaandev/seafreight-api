export function requireIsolatedTestDatabase(): void {
    const name = process.env.DB_NAME || '';
    if (process.env.ISOLATED_TEST_DB !== '1' ||
        process.env.TEST_DB_RUN_NAME !== name ||
        !/^codex_test_\d+_\d+_[a-f0-9]{8}$/.test(name)) {
        throw new Error('Database tests must run through npm test, which creates a disposable database.');
    }
}
