import { randomUUID } from 'crypto';
import db from '../connection.js';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const ACTOR_ID = '00000000-0000-0000-0000-000000000002';

async function seed() {
    console.log('🌱 Starting Sea Freight seed...');

    // Clear existing test data
    await db('exception_case').del();
    await db('audit_log').del();
    await db('file_document').del();
    await db('drayage_order').del();
    await db('freight_container').del();
    await db('freight_file').del();

    // 1. Sea Import: Release Pending (Waiting for customs & container release)
    const file1Id = randomUUID();
    await db('freight_file').insert({
        id: file1Id,
        human_id: 'SF-2026-00001',
        workspace_id: WORKSPACE_ID,
        mode: 'sea',
        direction: 'import',
        status: 'release_pending',
        shipper_name: 'Shanghai Electronics Co. Ltd',
        consignee_name: 'Rotterdam Tech Logistics B.V.',
        notify_party_name: 'Your Cargo Contact Customs Desk',
        carrier_name: 'Maersk Line',
        pol: 'CNSHA',
        pod: 'NLRTM',
        incoterm: 'FOB',
        vessel_name: 'Madrid Maersk',
        voyage_number: '2601W',
        eta: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        bl_release_gate_passed: true,
        customs_release_gate_passed: false,
        container_release_gate_passed: false,
        vgm_cutoff_gate_passed: false,
        special_handling_type: 'none',
        special_handling_status: 'green',
        customs_declaration_status: 'submitted',
        customs_declaration_id: 'DMS-2026-098123',
        total_cost: 2450.0,
        currency: 'EUR',
        created_by: ACTOR_ID,
        version: 1,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
    });

    const container1Id = randomUUID();
    await db('freight_container').insert({
        id: container1Id,
        freight_file_id: file1Id,
        container_number: 'MSKU9082341',
        container_type: '40HC',
        seal_number: 'MSK891273',
        tare_weight_kg: 3850.0,
        cargo_weight_kg: 18500.0,
        vgm_weight_kg: 22350.0,
        vgm_method: 'method_1',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
    });

    await db('drayage_order').insert({
        id: randomUUID(),
        freight_file_id: file1Id,
        container_id: container1Id,
        order_number: 'TR-2026-00101',
        type: 'import_delivery',
        terminal_name: 'APM Terminals Maasvlakte II',
        facility_address: 'Distripark Maasvlakte, 3199 LK Rotterdam',
        trucking_company: 'Vos Transport B.V.',
        driver_name: 'Jan de Vries',
        truck_plate: '78-BZX-9',
        status: 'draft',
        scheduled_at: new Date(Date.now() + 4 * 24 * 3600 * 1000),
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
    });

    // 2. Sea Import: Arrived (Demurrage Watch < 48 hours remaining)
    const file2Id = randomUUID();
    const freeTimeExpiry = new Date(Date.now() + 36 * 3600 * 1000); // 36 hours remaining
    await db('freight_file').insert({
        id: file2Id,
        human_id: 'SF-2026-00002',
        workspace_id: WORKSPACE_ID,
        mode: 'sea',
        direction: 'import',
        status: 'arrived',
        shipper_name: 'Ningbo Solar Panel Manufacturing',
        consignee_name: 'Amsterdam Green Energy Group',
        notify_party_name: 'Amsterdam Green Energy Group',
        carrier_name: 'MSC Mediterranean Shipping',
        pol: 'CNNGB',
        pod: 'NLRTM',
        incoterm: 'CIF',
        vessel_name: 'MSC Oscar',
        voyage_number: 'MO2603',
        ata: new Date(Date.now() - 12 * 3600 * 1000),
        bl_release_gate_passed: true,
        customs_release_gate_passed: true,
        container_release_gate_passed: true,
        vgm_cutoff_gate_passed: false,
        special_handling_type: 'none',
        special_handling_status: 'green',
        free_time_expires_at: freeTimeExpiry,
        customs_declaration_status: 'accepted',
        customs_declaration_id: 'DMS-2026-077431',
        total_cost: 3800.0,
        currency: 'EUR',
        created_by: ACTOR_ID,
        version: 1,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
    });

    await db('freight_container').insert([
        {
            id: randomUUID(),
            freight_file_id: file2Id,
            container_number: 'MEDU1298471',
            container_type: '40HC',
            seal_number: 'MSC981273',
            tare_weight_kg: 3900.0,
            cargo_weight_kg: 21500.0,
            vgm_weight_kg: 25400.0,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        },
        {
            id: randomUUID(),
            freight_file_id: file2Id,
            container_number: 'MEDU5928172',
            container_type: '40HC',
            seal_number: 'MSC981274',
            tare_weight_kg: 3900.0,
            cargo_weight_kg: 20800.0,
            vgm_weight_kg: 24700.0,
            created_at: db.fn.now(),
            updated_at: db.fn.now(),
        },
    ]);

    await db('exception_case').insert({
        id: randomUUID(),
        workspace_id: WORKSPACE_ID,
        freight_file_id: file2Id,
        type: 'demurrage_risk',
        severity: 'warn',
        status: 'open',
        title: 'Demurrage clock active (36h remaining)',
        description: `Vessel arrived at APMT Rotterdam. Free time expires at ${freeTimeExpiry.toISOString()}. Priority drayage haulage required.`,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
    });

    // 3. Sea Export: Booked with IMDG Dangerous Goods Overlay
    const file3Id = randomUUID();
    await db('freight_file').insert({
        id: file3Id,
        human_id: 'SF-2026-00003',
        workspace_id: WORKSPACE_ID,
        mode: 'sea',
        direction: 'export',
        status: 'booked',
        shipper_name: 'Bayer CropScience NL',
        consignee_name: 'Singapore Agritech Hub Pte',
        notify_party_name: 'Singapore Agritech Hub Pte',
        carrier_name: 'CMA CGM',
        pol: 'NLRTM',
        pod: 'SGSIN',
        incoterm: 'CPT',
        vessel_name: 'CMA CGM Palais Royal',
        voyage_number: '0PR26E',
        etd: new Date(Date.now() + 5 * 24 * 3600 * 1000),
        vgm_cutoff_at: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        bl_release_gate_passed: false,
        customs_release_gate_passed: false,
        container_release_gate_passed: false,
        vgm_cutoff_gate_passed: false,
        special_handling_type: 'imdg',
        special_handling_status: 'green',
        customs_declaration_status: 'none',
        total_cost: 1950.0,
        currency: 'EUR',
        created_by: ACTOR_ID,
        version: 1,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
    });

    await db('freight_container').insert({
        id: randomUUID(),
        freight_file_id: file3Id,
        container_number: 'CMAU7812903',
        container_type: '20GP',
        seal_number: 'CMA110294',
        tare_weight_kg: 2200.0,
        cargo_weight_kg: 12400.0,
        vgm_weight_kg: 14600.0,
        vgm_method: 'method_1',
        vgm_submitted_at: db.fn.now(),
        vgm_verified_by: 'Euroports Certified Weighing',
        imdg_class: '3',
        un_number: 'UN1993',
        packing_group: 'II',
        proper_shipping_name: 'FLAMMABLE LIQUID, N.O.S. (PESTICIDE MIXTURE)',
        msds_attached: true,
        dg_declaration_attached: true,
        carrier_dg_accepted: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
    });

    // 4. Sea Export: Reefer Cargo (VGM & SI Submitted)
    const file4Id = randomUUID();
    await db('freight_file').insert({
        id: file4Id,
        human_id: 'SF-2026-00004',
        workspace_id: WORKSPACE_ID,
        mode: 'sea',
        direction: 'export',
        status: 'vgm_si_submitted',
        shipper_name: 'Friesland Dairy Export B.V.',
        consignee_name: 'Jebel Ali Cold Storage LLC',
        notify_party_name: 'Dubai Logistics Partners',
        carrier_name: 'Hapag-Lloyd',
        pol: 'NLRTM',
        pod: 'AEJEA',
        incoterm: 'DAP',
        vessel_name: 'Al Jmeliyah',
        voyage_number: 'HL2605E',
        etd: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        vgm_cutoff_at: new Date(Date.now() + 1 * 24 * 3600 * 1000),
        bl_release_gate_passed: false,
        customs_release_gate_passed: false,
        container_release_gate_passed: false,
        vgm_cutoff_gate_passed: true,
        special_handling_type: 'reefer',
        special_handling_status: 'green',
        customs_declaration_status: 'submitted',
        customs_declaration_id: 'DMS-2026-081944',
        total_cost: 4200.0,
        currency: 'EUR',
        created_by: ACTOR_ID,
        version: 1,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
    });

    await db('freight_container').insert({
        id: randomUUID(),
        freight_file_id: file4Id,
        container_number: 'HLCU4901284',
        container_type: '40RF',
        seal_number: 'HL981290',
        tare_weight_kg: 4400.0,
        cargo_weight_kg: 24050.0,
        vgm_weight_kg: 28450.0,
        vgm_method: 'method_1',
        vgm_submitted_at: db.fn.now(),
        vgm_verified_by: 'Rotterdam Cold Hub Weighing',
        temperature_setpoint_c: -18.0,
        ventilation_cbm_hr: 15.0,
        humidity_percent: 65.0,
        pre_trip_inspection_passed: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
    });

    console.log('✅ Seed finished successfully! Inserted 4 Sea Freight operational dossiers.');
    process.exit(0);
}

seed().catch((err) => {
    console.error('❌ Seeding error:', err);
    process.exit(1);
});
