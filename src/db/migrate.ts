import db from './connection.js';

async function runMigration() {
    console.log('🔄 Resetting and running fresh migrations...');

    // Drop knex migration lock/log tables if resetting
    try {
        await db.raw('SET FOREIGN_KEY_CHECKS = 0');
        const tables = [
            'target',
            'document_ref',
            'processed_message',
            'outbox',
            'audit_log',
            'charge',
            'exception_case',
            'milestone',
            't1_bonded_event',
            'drayage_order',
            'file_note',
            'file_document',
            'bill_of_lading',
            'freight_line',
            'freight_container',
            'freight_file',
            'goods_item',
            'commodity_code',
            'carrier',
            'currency',
            'incoterm',
            'location',
            'notify_party',
            'consignee',
            'consignor',
            'contact',
            'client',
            'app_user',
            'role_permission',
            'permission',
            'role',
            'workspace',
            'knex_migrations',
            'knex_migrations_lock',
        ];
        for (const tbl of tables) {
            await db.raw(`DROP TABLE IF EXISTS \`${tbl}\``);
        }
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');
        console.log('🧹 Cleaned existing tables.');
    } catch (e) {
        console.warn('Warning during table reset:', e);
    }

    try {
        const [batchNo, log] = await db.migrate.latest({
            directory: './src/db/migrations',
            loadExtensions: ['.ts', '.js'],
        });
        console.log(`✅ Migrations completed in batch ${batchNo}:`);
        for (const file of log) {
            console.log(`   - ${file}`);
        }
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
