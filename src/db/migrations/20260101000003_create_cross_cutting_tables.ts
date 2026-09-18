import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // 1. Append-Only Audit Log
    await knex.schema.createTable('audit_log', (t) => {
        t.string('id', 36).primary();
        t.string('workspace_id', 36).notNullable();
        t.string('actor_id', 36).notNullable();
        t.string('entity_type', 50).notNullable();
        t.string('entity_id', 36).notNullable();
        t.string('action', 50).notNullable();
        t.string('from_state', 50).nullable();
        t.string('to_state', 50).nullable();
        t.text('payload').nullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

        t.index(['workspace_id', 'entity_type', 'entity_id']);
        t.index(['created_at']);
    });

    // 2. Transactional Outbox
    await knex.schema.createTable('outbox', (t) => {
        t.string('id', 36).primary();
        t.string('workspace_id', 36).notNullable();
        t.string('event_id', 36).notNullable().unique();
        t.string('event_type', 100).notNullable();
        t.text('payload').notNullable();
        t.string('status', 20).notNullable().defaultTo('pending'); // pending, published, failed
        t.integer('retry_count').notNullable().defaultTo(0);
        t.text('error_message').nullable();
        t.timestamp('published_at').nullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

        t.index(['status', 'created_at']);
        t.index(['workspace_id', 'event_type']);
    });

    // 3. Processed Messages (Consumer Idempotency Deduplication)
    await knex.schema.createTable('processed_message', (t) => {
        t.string('id', 36).primary();
        t.string('workspace_id', 36).notNullable();
        t.string('message_id', 100).notNullable().unique();
        t.string('event_type', 100).notNullable();
        t.timestamp('processed_at').notNullable().defaultTo(knex.fn.now());

        t.index(['message_id']);
    });

    // 4. Document References (MinIO Object storage metadata)
    await knex.schema.createTable('document_ref', (t) => {
        t.string('id', 36).primary();
        t.string('workspace_id', 36).notNullable();
        t.string('storage_key', 255).notNullable();
        t.string('integrity_hash', 64).notNullable();
        t.string('file_name', 255).notNullable();
        t.string('mime_type', 100).nullable();
        t.integer('file_size_bytes').nullable();
        t.string('created_by', 36).notNullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

        t.index(['workspace_id', 'storage_key']);
    });

    // 5. Effective-Dated KPI Targets
    await knex.schema.createTable('target', (t) => {
        t.string('id', 36).primary();
        t.string('workspace_id', 36).notNullable();
        t.string('metric_name', 100).notNullable();
        t.decimal('target_value', 10, 2).notNullable();
        t.timestamp('effective_from').notNullable();
        t.timestamp('effective_to').nullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.string('created_by', 36).notNullable();
        t.integer('version').notNullable().defaultTo(1);

        t.index(['workspace_id', 'metric_name', 'effective_from']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('target');
    await knex.schema.dropTableIfExists('document_ref');
    await knex.schema.dropTableIfExists('processed_message');
    await knex.schema.dropTableIfExists('outbox');
    await knex.schema.dropTableIfExists('audit_log');
}
