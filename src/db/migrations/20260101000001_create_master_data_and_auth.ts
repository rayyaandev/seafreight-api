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
    // 1. Workspace
    await knex.schema.createTable('workspace', (t) => {
        addStandardColumns(t, knex);
        t.string('name', 100).notNullable();
        t.string('code', 50).notNullable().unique();
        t.string('domain', 100).nullable();
    });

    // 2. Roles
    await knex.schema.createTable('role', (t) => {
        addStandardColumns(t, knex);
        t.string('name', 100).notNullable();
        t.string('description', 255).nullable();
    });

    // 3. Permissions
    await knex.schema.createTable('permission', (t) => {
        addStandardColumns(t, knex);
        t.string('code', 100).notNullable().unique();
        t.string('description', 255).nullable();
    });

    // 4. Role Permissions
    await knex.schema.createTable('role_permission', (t) => {
        t.string('id', 36).primary();
        t.string('role_id', 36).notNullable().references('id').inTable('role').onDelete('CASCADE');
        t.string('permission_id', 36).notNullable().references('id').inTable('permission').onDelete('CASCADE');
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.unique(['role_id', 'permission_id']);
    });

    // 5. App Users
    await knex.schema.createTable('app_user', (t) => {
        addStandardColumns(t, knex);
        t.string('email', 150).notNullable().unique();
        t.string('password_hash', 255).notNullable();
        t.string('name', 100).notNullable();
        t.string('role_id', 36).notNullable().references('id').inTable('role');
        t.boolean('is_active').notNullable().defaultTo(true);
        t.index(['workspace_id', 'email']);
    });

    // 6. Clients
    await knex.schema.createTable('client', (t) => {
        addStandardColumns(t, knex);
        t.string('name', 150).notNullable();
        t.string('code', 50).notNullable();
        t.string('type', 50).notNullable().defaultTo('customer');
        t.string('tax_number', 50).nullable();
        t.string('address', 255).nullable();
        t.string('country', 50).nullable();
        t.index(['workspace_id', 'name']);
    });

    // 7. Contacts
    await knex.schema.createTable('contact', (t) => {
        addStandardColumns(t, knex);
        t.string('client_id', 36).notNullable().references('id').inTable('client').onDelete('CASCADE');
        t.string('name', 100).notNullable();
        t.string('email', 150).nullable();
        t.string('phone', 50).nullable();
    });

    // 8. Consignors, Consignees, Notify Parties
    await knex.schema.createTable('consignor', (t) => {
        addStandardColumns(t, knex);
        t.string('name', 150).notNullable();
        t.string('address', 255).nullable();
        t.string('country', 50).nullable();
    });

    await knex.schema.createTable('consignee', (t) => {
        addStandardColumns(t, knex);
        t.string('name', 150).notNullable();
        t.string('address', 255).nullable();
        t.string('country', 50).nullable();
    });

    await knex.schema.createTable('notify_party', (t) => {
        addStandardColumns(t, knex);
        t.string('name', 150).notNullable();
        t.string('address', 255).nullable();
        t.string('country', 50).nullable();
    });

    // 9. Locations (Ports with UN/LOCODE)
    await knex.schema.createTable('location', (t) => {
        addStandardColumns(t, knex);
        t.string('un_locode', 10).notNullable();
        t.string('name', 100).notNullable();
        t.string('country_code', 5).notNullable();
        t.string('type', 30).notNullable().defaultTo('port');
        t.index(['un_locode']);
        t.index(['name']);
    });

    // 10. Incoterms
    await knex.schema.createTable('incoterm', (t) => {
        addStandardColumns(t, knex);
        t.string('code', 10).notNullable();
        t.string('description', 200).notNullable();
    });

    // 11. Currencies
    await knex.schema.createTable('currency', (t) => {
        addStandardColumns(t, knex);
        t.string('code', 3).notNullable();
        t.string('name', 50).notNullable();
        t.string('symbol', 10).notNullable();
    });

    // 12. Commodity Codes & Goods Items
    await knex.schema.createTable('commodity_code', (t) => {
        addStandardColumns(t, knex);
        t.string('hs_code', 20).notNullable();
        t.string('description', 255).notNullable();
        t.index(['hs_code']);
    });

    await knex.schema.createTable('goods_item', (t) => {
        addStandardColumns(t, knex);
        t.string('commodity_code_id', 36).nullable().references('id').inTable('commodity_code');
        t.string('name', 150).notNullable();
        t.text('description').nullable();
    });

    // 13. Carriers
    await knex.schema.createTable('carrier', (t) => {
        addStandardColumns(t, knex);
        t.string('name', 100).notNullable();
        t.string('scac_code', 10).nullable();
        t.string('line_code', 20).nullable();
        t.index(['name']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('carrier');
    await knex.schema.dropTableIfExists('goods_item');
    await knex.schema.dropTableIfExists('commodity_code');
    await knex.schema.dropTableIfExists('currency');
    await knex.schema.dropTableIfExists('incoterm');
    await knex.schema.dropTableIfExists('location');
    await knex.schema.dropTableIfExists('notify_party');
    await knex.schema.dropTableIfExists('consignee');
    await knex.schema.dropTableIfExists('consignor');
    await knex.schema.dropTableIfExists('contact');
    await knex.schema.dropTableIfExists('client');
    await knex.schema.dropTableIfExists('app_user');
    await knex.schema.dropTableIfExists('role_permission');
    await knex.schema.dropTableIfExists('permission');
    await knex.schema.dropTableIfExists('role');
    await knex.schema.dropTableIfExists('workspace');
}
