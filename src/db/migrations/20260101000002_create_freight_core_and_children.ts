import type { Knex } from 'knex';

function addStandardColumns(t: Knex.CreateTableBuilder, knex: Knex) {
    t.string('id', 36).primary();
    t.string('workspace_id', 36).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.string('created_by', 36).notNullable();
    t.integer('version').notNullable().defaultTo(1);
}

export async function up(knex: Knex): Promise<void> {
    // 1. Core Freight File Table
    await knex.schema.createTable('freight_file', (t) => {
        addStandardColumns(t, knex);
        t.string('file_no', 32).notNullable().unique(); // e.g. SF-2026-00042
        t.string('mode', 10).notNullable().defaultTo('sea');
        t.string('direction', 10).notNullable(); // 'import' or 'export'
        t.string('status', 32).notNullable().defaultTo('Draft');

        // Master Data References
        t.string('customer_id', 36).nullable().references('id').inTable('client');
        t.string('shipper_id', 36).nullable().references('id').inTable('client');
        t.string('consignee_id', 36).nullable().references('id').inTable('client');
        t.string('notify_party_id', 36).nullable().references('id').inTable('client');
        t.string('carrier_id', 36).nullable().references('id').inTable('carrier');
        t.string('pol_id', 36).nullable().references('id').inTable('location');
        t.string('pod_id', 36).nullable().references('id').inTable('location');
        t.string('incoterm_id', 36).nullable().references('id').inTable('incoterm');

        // Voyage & Vessel details
        t.string('vessel', 120).nullable();
        t.string('voyage', 40).nullable();
        t.timestamp('etd').nullable();
        t.timestamp('eta').nullable();
        t.timestamp('ata').nullable();
        t.timestamp('atd').nullable();

        // Export Cut-offs
        t.timestamp('doc_cutoff').nullable();
        t.timestamp('vgm_cutoff').nullable();
        t.timestamp('gate_cutoff').nullable();

        // Special Handling & Overlay Status
        t.string('special_handling', 20).notNullable().defaultTo('NONE'); // IMDG, REEFER, OOG, NONE
        t.string('special_status', 20).notNullable().defaultTo('GREEN'); // GREEN, ORANGE, RED

        // Demurrage & Customs
        t.integer('free_time_days').notNullable().defaultTo(5);
        t.string('declaration_id', 64).nullable();
        t.string('declaration_status', 30).notNullable().defaultTo('none');
        t.string('mrn', 64).nullable();
        t.timestamp('container_release_received_at').nullable();
        t.boolean('lc_flag').notNullable().defaultTo(false);

        // Commercials
        t.decimal('total_cost', 14, 2).nullable();
        t.string('currency', 3).nullable().defaultTo('EUR');
        t.timestamp('deleted_at').nullable();

        // Indices
        t.index(['workspace_id', 'mode', 'status']);
        t.index(['workspace_id', 'direction']);
        t.index(['workspace_id', 'file_no']);
    });

    // 2. Freight Containers
    await knex.schema.createTable('freight_container', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('container_number', 20).notNullable();
        t.string('type', 10).notNullable(); // 20DV, 40HC, 40RF, etc.
        t.string('seal_number', 50).nullable();

        // Weights & VGM
        t.decimal('tare_weight_kg', 10, 2).nullable();
        t.decimal('gross_weight_kg', 10, 2).nullable();
        t.decimal('vgm_kg', 10, 2).nullable();
        t.timestamp('vgm_submitted_at').nullable();
        t.string('vgm_method', 20).nullable();
        t.timestamp('gate_in_at').nullable();
        t.timestamp('gate_out_at').nullable();

        // Reefer settings
        t.decimal('temperature_setpoint_c', 5, 2).nullable();
        t.decimal('ventilation_cbm_hr', 6, 2).nullable();
        t.decimal('humidity_percent', 5, 2).nullable();
        t.boolean('pre_trip_inspection_passed').notNullable().defaultTo(false);

        // IMDG / Dangerous Goods
        t.string('imdg_class', 10).nullable();
        t.string('un_number', 10).nullable();
        t.string('packing_group', 10).nullable();
        t.string('proper_shipping_name', 255).nullable();
        t.boolean('msds_attached').notNullable().defaultTo(false);
        t.boolean('dg_declaration_attached').notNullable().defaultTo(false);
        t.boolean('carrier_dg_accepted').notNullable().defaultTo(false);

        // Out-of-gauge (OOG)
        t.boolean('is_oog').notNullable().defaultTo(false);
        t.text('oog_dimensions').nullable();

        t.index(['freight_file_id']);
        t.index(['container_number']);
    });

    // 3. Freight Lines (Goods items)
    await knex.schema.createTable('freight_line', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('description', 255).notNullable();
        t.string('commodity_code', 20).nullable();
        t.decimal('quantity', 12, 3).notNullable();
        t.integer('packages').nullable();
        t.decimal('weight_kg', 12, 2).nullable();
        t.decimal('volume_cbm', 10, 3).nullable();
        t.decimal('value_amount', 14, 2).nullable();
        t.string('currency', 3).notNullable().defaultTo('EUR');
        t.index(['freight_file_id']);
    });

    // 4. Bills of Lading
    await knex.schema.createTable('bill_of_lading', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('type', 10).notNullable(); // 'MBL' or 'HBL'
        t.string('bl_number', 50).notNullable();
        t.timestamp('issue_date').nullable();
        t.boolean('telex_release').notNullable().defaultTo(false);
        t.boolean('original_received').notNullable().defaultTo(false);
        t.timestamp('released_at').nullable();
        t.text('shipping_instructions').nullable();
        t.boolean('draft_approved').notNullable().defaultTo(false);
        t.index(['freight_file_id']);
        t.index(['bl_number']);
    });

    // 5. File Documents
    await knex.schema.createTable('file_document', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('doc_type', 50).notNullable();
        t.string('file_name', 255).notNullable();
        t.string('file_url', 500).nullable();
        t.string('storage_key', 255).nullable();
        t.string('integrity_hash', 64).nullable();
        t.string('mime_type', 100).nullable();
        t.integer('file_size_bytes').nullable();
        t.decimal('ocr_confidence', 4, 3).nullable();
        t.text('ocr_extracted_data').nullable();
        t.index(['freight_file_id', 'doc_type']);
    });

    // 6. File Notes
    await knex.schema.createTable('file_note', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.text('note_text').notNullable();
        t.boolean('show_on_open').notNullable().defaultTo(false);
        t.index(['freight_file_id']);
    });

    // 7. Drayage Transport Orders
    await knex.schema.createTable('drayage_order', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('container_id', 36).nullable().references('id').inTable('freight_container').onDelete('SET NULL');
        t.string('order_number', 32).notNullable().unique();
        t.string('type', 30).notNullable(); // 'import_delivery', etc.
        t.string('terminal_name', 100).notNullable();
        t.string('facility_address', 255).notNullable();
        t.string('trucking_company', 100).nullable();
        t.string('driver_name', 100).nullable();
        t.string('truck_plate', 20).nullable();
        t.string('chassis_number', 30).nullable();
        t.string('status', 30).notNullable().defaultTo('draft');
        t.timestamp('scheduled_at').nullable();
        t.timestamp('gate_in_at').nullable();
        t.timestamp('gate_out_at').nullable();
        t.timestamp('delivered_at').nullable();
        t.string('pod_signature_ref', 255).nullable();
        t.index(['freight_file_id']);
        t.index(['order_number']);
    });

    // 8. T1 & Bonded Events
    await knex.schema.createTable('t1_bonded_event', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('event_type', 30).notNullable(); // 't1_open', 't1_close', 'inslag', 'uitslag'
        t.string('mrn', 64).nullable();
        t.string('bonded_warehouse_ref', 100).nullable();
        t.timestamp('occurred_at').notNullable().defaultTo(knex.fn.now());
        t.index(['freight_file_id']);
    });

    // 9. Milestones
    await knex.schema.createTable('milestone', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('milestone_type', 50).notNullable(); // 'collected', 'customs_cleared', etc.
        t.timestamp('timestamp').notNullable().defaultTo(knex.fn.now());
        t.string('source', 50).notNullable().defaultTo('system');
        t.index(['freight_file_id']);
    });

    // 10. Exception Cases
    await knex.schema.createTable('exception_case', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('gate_code', 50).nullable();
        t.string('type', 50).notNullable().defaultTo('other');
        t.string('severity', 20).notNullable().defaultTo('warn'); // info, warn, critical
        t.string('status', 20).notNullable().defaultTo('Open'); // Open, InProgress, Resolved, Closed
        t.string('title', 255).notNullable();
        t.text('description').nullable();
        t.string('assignee_id', 36).nullable().references('id').inTable('app_user');
        t.text('resolution_notes').nullable();
        t.string('resolved_by', 36).nullable().references('id').inTable('app_user');
        t.timestamp('resolved_at').nullable();
        t.index(['workspace_id', 'freight_file_id', 'status']);
    });

    // 11. Charges (Sell & Buy Lines)
    await knex.schema.createTable('charge', (t) => {
        addStandardColumns(t, knex);
        t.string('freight_file_id', 36).notNullable().references('id').inTable('freight_file').onDelete('CASCADE');
        t.string('line_type', 10).notNullable(); // 'sell' or 'buy'
        t.string('service_name', 100).notNullable();
        t.decimal('amount', 14, 2).notNullable();
        t.string('currency', 3).notNullable().defaultTo('EUR');
        t.string('invoice_ref', 50).nullable();
        t.index(['freight_file_id', 'line_type']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('charge');
    await knex.schema.dropTableIfExists('exception_case');
    await knex.schema.dropTableIfExists('milestone');
    await knex.schema.dropTableIfExists('t1_bonded_event');
    await knex.schema.dropTableIfExists('drayage_order');
    await knex.schema.dropTableIfExists('file_note');
    await knex.schema.dropTableIfExists('file_document');
    await knex.schema.dropTableIfExists('bill_of_lading');
    await knex.schema.dropTableIfExists('freight_line');
    await knex.schema.dropTableIfExists('freight_container');
    await knex.schema.dropTableIfExists('freight_file');
}
