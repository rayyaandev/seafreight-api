import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('integration_job', (t) => {
        t.string('provider_reference', 100).nullable();
        t.string('reply_status', 20).nullable();
        t.index(['workspace_id', 'provider', 'provider_reference']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('integration_job', (t) => {
        t.dropIndex(['workspace_id', 'provider', 'provider_reference']);
        t.dropColumn('reply_status');
        t.dropColumn('provider_reference');
    });
}
