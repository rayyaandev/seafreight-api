import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('auth_session', (t) => {
        t.string('id', 36).primary();
        t.string('user_id', 36).notNullable().references('id').inTable('app_user').onDelete('CASCADE');
        t.string('workspace_id', 36).notNullable();
        t.timestamp('expires_at').notNullable();
        t.timestamp('revoked_at').nullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.index(['user_id', 'workspace_id']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('auth_session');
}
