import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('drayage_order', (t) => {
        t.string('trucking_order_id', 100).nullable();
        t.string('pickup_address', 255).nullable();
        t.string('delivery_address', 255).nullable();
        t.timestamp('planned_pickup_at').nullable();
        t.timestamp('planned_delivery_at').nullable();
        t.timestamp('actual_pickup_at').nullable();
        t.timestamp('actual_delivery_at').nullable();
        t.unique(['workspace_id', 'trucking_order_id']);
    });
    await knex.schema.alterTable('t1_bonded_event', (t) => {
        t.string('document_id', 36).nullable();
        t.index(['workspace_id', 'freight_file_id', 'occurred_at']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('t1_bonded_event', (t) => {
        t.dropIndex(['workspace_id', 'freight_file_id', 'occurred_at']);
        t.dropColumn('document_id');
    });
    await knex.schema.alterTable('drayage_order', (t) => {
        t.dropUnique(['workspace_id', 'trucking_order_id']);
        t.dropColumn('trucking_order_id');
        t.dropColumn('pickup_address');
        t.dropColumn('delivery_address');
        t.dropColumn('planned_pickup_at');
        t.dropColumn('planned_delivery_at');
        t.dropColumn('actual_pickup_at');
        t.dropColumn('actual_delivery_at');
    });
}
