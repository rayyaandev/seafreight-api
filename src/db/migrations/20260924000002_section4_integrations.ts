import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('integration_job', (t) => {
        t.string('id', 36).primary();
        t.string('workspace_id', 36).notNullable();
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('provider', 20).notNullable();
        t.string('operation', 40).notNullable();
        t.text('request_payload').notNullable();
        t.text('result_payload').nullable();
        t.string('status', 20).notNullable().defaultTo('pending');
        t.integer('attempts').notNullable().defaultTo(0);
        t.text('error_message').nullable();
        t.timestamp('next_attempt_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.index(['status', 'next_attempt_at']);
        t.index(['workspace_id', 'freight_file_id']);
    });
    await knex.schema.alterTable('freight_file', (t) => {
        t.string('carrier_booking_ref', 100).nullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('freight_file', (t) => t.dropColumn('carrier_booking_ref'));
    await knex.schema.dropTableIfExists('integration_job');
}
