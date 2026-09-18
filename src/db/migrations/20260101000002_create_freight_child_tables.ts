import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // 1. Containers / Cargo Lines
    await knex.schema.createTable('freight_container', (t) => {
        t.uuid('id').primary();
        t.uuid('freight_file_id')
            .notNullable()
            .references('id')
            .inTable('freight_file')
            .onDelete('CASCADE');

        t.string('container_number', 20).notNullable();
        t.string('container_type', 10).notNullable(); // 20GP, 40HC, 40RF, etc.
        t.string('seal_number', 50).nullable();

        // Weights & VGM
        t.decimal('tare_weight_kg', 10, 2).nullable();
        t.decimal('cargo_weight_kg', 10, 2).nullable();
        t.decimal('vgm_weight_kg', 10, 2).nullable();
        t.enu('vgm_method', ['method_1', 'method_2']).nullable();
        t.timestamp('vgm_submitted_at').nullable();
        t.string('vgm_verified_by', 100).nullable();

        // Reefer details
        t.decimal('temperature_setpoint_c', 5, 2).nullable();
        t.decimal('ventilation_cbm_hr', 6, 2).nullable();
        t.decimal('humidity_percent', 5, 2).nullable();
        t.boolean('pre_trip_inspection_passed').notNullable().defaultTo(false);

        // IMDG / Dangerous goods details
        t.string('imdg_class', 10).nullable();
        t.string('un_number', 10).nullable();
        t.enu('packing_group', ['I', 'II', 'III']).nullable();
        t.string('proper_shipping_name', 255).nullable();
        t.boolean('msds_attached').notNullable().defaultTo(false);
        t.boolean('dg_declaration_attached').notNullable().defaultTo(false);
        t.boolean('carrier_dg_accepted').notNullable().defaultTo(false);

        // Out-of-gauge (OOG)
        t.boolean('is_oog').notNullable().defaultTo(false);
        t.text('oog_dimensions').nullable();

        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

        t.index(['freight_file_id']);
        t.index(['container_number']);
    });

    // 2. Drayage Transport Orders (Terminal <-> Shipper/Consignee)
    await knex.schema.createTable('drayage_order', (t) => {
        t.uuid('id').primary();
        t.uuid('freight_file_id')
            .notNullable()
            .references('id')
            .inTable('freight_file')
            .onDelete('CASCADE');
        t.uuid('container_id').nullable();

        t.string('order_number', 32).notNullable().unique(); // TR-2026-00001
        t.enu('type', ['import_delivery', 'export_positioning', 'empty_reposition']).notNullable();
        t.string('terminal_name', 100).notNullable();
        t.string('facility_address', 255).notNullable();
        t.string('trucking_company', 100).nullable();
        t.string('driver_name', 100).nullable();
        t.string('truck_plate', 20).nullable();
        t.string('chassis_number', 30).nullable();

        t.enu('status', ['draft', 'scheduled', 'en_route', 'gate_in', 'gate_out', 'delivered', 'cancelled'])
            .notNullable()
            .defaultTo('draft');

        t.timestamp('scheduled_at').nullable();
        t.timestamp('gate_in_at').nullable();
        t.timestamp('gate_out_at').nullable();
        t.timestamp('delivered_at').nullable();
        t.string('pod_signature_ref', 255).nullable();

        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

        t.index(['freight_file_id']);
        t.index(['order_number']);
    });

    // 3. File Documents & OCR Intake
    await knex.schema.createTable('file_document', (t) => {
        t.uuid('id').primary();
        t.uuid('freight_file_id')
            .notNullable()
            .references('id')
            .inTable('freight_file')
            .onDelete('CASCADE');

        t.enu('doc_type', [
            'mbl',
            'hbl',
            'booking_confirmation',
            'arrival_notice',
            'commercial_invoice',
            'packing_list',
            'vgm_certificate',
            'delivery_order',
            't1_document',
            'imdg_declaration',
            'msds',
            'customs_release_doc',
            'pod_receipt',
            'other',
        ]).notNullable();

        t.string('file_name', 255).notNullable();
        t.string('file_url', 500).notNullable();
        t.integer('file_size_bytes').nullable();
        t.string('mime_type', 100).nullable();

        t.boolean('is_ocr_processed').notNullable().defaultTo(false);
        t.decimal('ocr_confidence', 4, 3).nullable();
        t.text('ocr_extracted_data').nullable();

        t.uuid('created_by').notNullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

        t.index(['freight_file_id', 'doc_type']);
    });

    // 4. Audit Log (Append-only)
    await knex.schema.createTable('audit_log', (t) => {
        t.uuid('id').primary();
        t.uuid('workspace_id').notNullable();
        t.uuid('actor_id').notNullable();
        t.string('entity_type', 50).notNullable(); // freight_file, container, etc.
        t.uuid('entity_id').notNullable();
        t.string('action', 50).notNullable();
        t.string('from_state', 50).nullable();
        t.string('to_state', 50).nullable();
        t.text('payload').nullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

        t.index(['workspace_id', 'entity_type', 'entity_id']);
        t.index(['created_at']);
    });

    // 5. Exception Hub Cases
    await knex.schema.createTable('exception_case', (t) => {
        t.uuid('id').primary();
        t.uuid('workspace_id').notNullable();
        t.uuid('freight_file_id')
            .notNullable()
            .references('id')
            .inTable('freight_file')
            .onDelete('CASCADE');

        t.enu('type', [
            'missing_bl',
            'carrier_hold',
            'demurrage_risk',
            'container_damage',
            'missed_cutoff',
            'vgm_discrepancy',
            'dg_non_acceptance',
            'customs_hold',
            'other',
        ]).notNullable();

        t.enu('severity', ['info', 'warn', 'critical']).notNullable().defaultTo('warn');
        t.enu('status', ['open', 'in_progress', 'resolved', 'closed']).notNullable().defaultTo('open');

        t.string('title', 255).notNullable();
        t.text('description').nullable();
        t.text('resolution_notes').nullable();
        t.uuid('assigned_to').nullable();
        t.uuid('resolved_by').nullable();
        t.timestamp('resolved_at').nullable();

        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

        t.index(['workspace_id', 'freight_file_id', 'status']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('exception_case');
    await knex.schema.dropTableIfExists('audit_log');
    await knex.schema.dropTableIfExists('file_document');
    await knex.schema.dropTableIfExists('drayage_order');
    await knex.schema.dropTableIfExists('freight_container');
}
