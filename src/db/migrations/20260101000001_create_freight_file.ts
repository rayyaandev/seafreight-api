import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('freight_file', (t) => {
        t.uuid('id').primary();
        t.string('human_id', 20).notNullable().unique(); // e.g. SF-2026-00001
        t.uuid('workspace_id').notNullable();

        t.enu('mode', ['sea', 'air']).notNullable().defaultTo('sea');
        t.enu('direction', ['import', 'export']).notNullable();
        t.string('status', 32).notNullable().defaultTo('draft');

        // parties — plain columns for now, no master data service yet
        t.string('shipper_name', 255);
        t.string('consignee_name', 255);
        t.string('notify_party_name', 255);
        t.string('carrier_name', 255);

        // route
        t.string('pol', 10); // port of loading
        t.string('pod', 10); // port of discharge
        t.string('incoterm', 10);

        // sea tracking
        t.string('vessel_name', 120);
        t.string('voyage_number', 40);
        t.timestamp('eta').nullable();
        t.timestamp('ata').nullable();
        t.timestamp('etd').nullable();
        t.timestamp('atd').nullable();

        // gates — state machine checks these before advancing
        t.boolean('bl_release_gate_passed').notNullable().defaultTo(false);
        t.boolean('customs_release_gate_passed').notNullable().defaultTo(false);
        t.boolean('container_release_gate_passed').notNullable().defaultTo(false);
        t.boolean('vgm_cutoff_gate_passed').notNullable().defaultTo(false);
        t.timestamp('vgm_cutoff_at').nullable();

        // special handling summary
        t.enu('special_handling_type', ['none', 'imdg', 'reefer', 'oog']).notNullable().defaultTo('none');
        t.enu('special_handling_status', ['green', 'orange', 'red']).notNullable().defaultTo('green');

        // demurrage/detention
        t.timestamp('free_time_expires_at').nullable();

        // customs linkage
        t.string('customs_declaration_id', 64).nullable();
        t.enu('customs_declaration_status', ['none', 'submitted', 'accepted', 'rejected', 'under_control'])
            .notNullable()
            .defaultTo('none');

        t.decimal('total_cost', 14, 2).nullable();
        t.string('currency', 3).nullable();

        t.uuid('created_by').notNullable();
        t.integer('version').notNullable().defaultTo(1); // optimistic concurrency
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('deleted_at').nullable();

        t.index(['workspace_id', 'mode', 'status']);
        t.index(['workspace_id', 'direction']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('freight_file');
}