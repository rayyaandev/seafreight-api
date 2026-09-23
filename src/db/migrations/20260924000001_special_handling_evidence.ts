import type { Knex } from 'knex';
import type { FreightContainerEntity, FreightFileEntity } from '../../common/types.js';

export function specialStatus(type: string, containers: FreightContainerEntity[]): 'GREEN' | 'ORANGE' | 'RED' {
    const yes = (value: boolean | number | undefined) => value === true || value === 1;
    const imdg = containers.filter((c) => Boolean(c.imdg_class || c.un_number || c.packing_group || c.proper_shipping_name || yes(c.msds_attached) || yes(c.dg_declaration_attached) || yes(c.carrier_dg_accepted)));
    const reefer = containers.filter((c) => c.type === '20RF' || c.type === '40RF' || c.temperature_setpoint_c != null);
    const oog = containers.filter((c) => yes(c.is_oog) || Boolean(c.oog_dimensions));
    if ((type === 'IMDG' && !imdg.length) || (type === 'REEFER' && !reefer.length) || (type === 'OOG' && !oog.length)) return 'RED';
    if (imdg.some((c) => !c.imdg_class || !c.un_number || !c.packing_group || !c.proper_shipping_name || !yes(c.msds_attached) || !yes(c.dg_declaration_attached) || !yes(c.carrier_dg_accepted) || !c.dg_segregation_requirements?.trim())) return 'RED';
    if (reefer.some((c) => c.temperature_setpoint_c == null || c.temperature_setpoint_c === '' || !yes(c.pre_trip_inspection_passed) || !yes(c.reefer_monitoring_confirmed))) return 'RED';
    if (oog.some((c) => !yes(c.is_oog) || !c.oog_dimensions?.trim())) return 'RED';
    if (reefer.some((c) => c.ventilation_cbm_hr == null || c.humidity_percent == null)) return 'ORANGE';
    return 'GREEN';
}

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('freight_container', (table) => {
        table.string('dg_segregation_requirements', 500).nullable();
        table.boolean('reefer_monitoring_confirmed').notNullable().defaultTo(false);
    });

    // Existing evidence must be rechecked before its stored colour can be trusted.
    const files = await knex<FreightFileEntity>('freight_file').select('id', 'workspace_id', 'special_handling', 'special_status');
    for (const file of files) {
        const containers = await knex<FreightContainerEntity>('freight_container')
            .where({ freight_file_id: file.id, workspace_id: file.workspace_id });
        const status = specialStatus(file.special_handling, containers);
        if (status !== file.special_status) {
            await knex('freight_file').where({ id: file.id, workspace_id: file.workspace_id }).update({
                special_status: status,
                version: knex.raw('version + 1'),
                updated_at: knex.fn.now(),
            });
        }
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('freight_container', (table) => {
        table.dropColumn('dg_segregation_requirements');
        table.dropColumn('reefer_monitoring_confirmed');
    });
    // Leave RED statuses in place for operator review after rollback.
}
