import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../connection.js';

export const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
export const USER_COORDINATOR_ID = '00000000-0000-0000-0000-000000000002';
export const USER_CUSTOMS_ID = '00000000-0000-0000-0000-000000000003';
export const USER_MANAGER_ID = '00000000-0000-0000-0000-000000000004';

export async function seedDatabase() {
    console.log('🌱 Starting complete Sea Freight Foundation seed...');

    // 1. Clear existing data in reverse foreign key order
    await db('processed_message').del();
    await db('outbox').del();
    await db('audit_log').del();
    await db('document_ref').del();
    await db('target').del();
    await db('integration_job').del();
    await db('charge').del();
    await db('exception_case').del();
    await db('milestone').del();
    await db('t1_bonded_event').del();
    await db('drayage_order').del();
    await db('file_note').del();
    await db('file_document').del();
    await db('bill_of_lading').del();
    await db('freight_line').del();
    await db('freight_container').del();
    await db('freight_file').del();
    await db('goods_item').del();
    await db('commodity_code').del();
    await db('carrier').del();
    await db('currency').del();
    await db('incoterm').del();
    await db('location').del();
    await db('notify_party').del();
    await db('consignee').del();
    await db('consignor').del();
    await db('contact').del();
    await db('client').del();
    await db('app_user').del();
    await db('role_permission').del();
    await db('permission').del();
    await db('role').del();
    await db('workspace').del();

    const now = new Date();

    // 2. Workspace
    await db('workspace').insert({
        id: WORKSPACE_ID,
        workspace_id: WORKSPACE_ID,
        name: 'Your Cargo Contact B.V.',
        code: 'YCC-NL',
        domain: 'yourcargocontact.com',
        created_by: USER_MANAGER_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    // 3. Permissions
    const permissions = [
        { code: 'freight.file.create', description: 'Create freight dossier' },
        { code: 'freight.file.read', description: 'View freight dossier and worklist' },
        { code: 'freight.file.update', description: 'Edit freight file fields' },
        { code: 'freight.file.delete', description: 'Delete/archive freight dossier' },
        { code: 'freight.file.release_bl', description: 'Surrender/release Bill of Lading' },
        { code: 'freight.file.record_ata', description: 'Record vessel arrival ATA' },
        { code: 'freight.file.clear', description: 'Clear customs and release container' },
        { code: 'freight.file.deliver', description: 'Confirm drayage delivery and POD' },
        { code: 'freight.file.book', description: 'Confirm carrier space booking' },
        { code: 'freight.file.submit_vgm', description: 'Submit Verified Gross Mass & SI' },
        { code: 'freight.file.load', description: 'Confirm container gate-in and vessel loading' },
        { code: 'freight.file.issue_bl', description: 'Issue final Bill of Lading' },
        { code: 'freight.file.close', description: 'Close file and transfer to finance' },
        { code: 'freight.file.special_handling', description: 'Review and update DG/Reefer/OOG status' },
        { code: 'masterdata.read', description: 'Query master data autocomplete' },
        { code: 'masterdata.write', description: 'Manage master data' },
        { code: 'exceptions.read', description: 'View exception cases' },
        { code: 'exceptions.write', description: 'Manage and resolve exception cases' },
        { code: 'dev.simulate', description: 'Publish simulated webhook/inbound events' },
    ];

    const permMap = new Map<string, string>();
    for (const p of permissions) {
        const id = randomUUID();
        permMap.set(p.code, id);
        await db('permission').insert({
            id,
            workspace_id: WORKSPACE_ID,
            code: p.code,
            description: p.description,
            created_by: USER_MANAGER_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        });
    }

    // 4. Roles
    const roles = [
        {
            name: 'Sea Freight Coordinator',
            description: 'Full operational control to create, update, and advance freight dossiers',
            perms: [
                'freight.file.create',
                'freight.file.read',
                'freight.file.update',
                'freight.file.release_bl',
                'freight.file.record_ata',
                'freight.file.clear',
                'freight.file.deliver',
                'freight.file.book',
                'freight.file.submit_vgm',
                'freight.file.load',
                'freight.file.issue_bl',
                'freight.file.close',
                'freight.file.special_handling',
                'masterdata.read',
                'exceptions.read',
                'exceptions.write',
                'dev.simulate',
            ],
        },
        {
            name: 'Customs',
            description: 'Customs specialists linking declarations and clearing portbase releases',
            perms: ['freight.file.read', 'freight.file.clear', 'masterdata.read', 'exceptions.read'],
        },
        {
            name: 'Finance',
            description: 'Finance and invoicing team tracking charges, margin, and file closure',
            perms: ['freight.file.read', 'freight.file.close', 'masterdata.read'],
        },
        {
            name: 'Operations Manager',
            description: 'Full management authority with exception override capabilities',
            perms: permissions.map((p) => p.code),
        },
        {
            name: 'Read-only',
            description: 'Read-only viewer for dashboards and status monitoring',
            perms: ['freight.file.read', 'masterdata.read', 'exceptions.read'],
        },
    ];

    const roleMap = new Map<string, string>();
    for (const r of roles) {
        const roleId = randomUUID();
        roleMap.set(r.name, roleId);
        await db('role').insert({
            id: roleId,
            workspace_id: WORKSPACE_ID,
            name: r.name,
            description: r.description,
            created_by: USER_MANAGER_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        });

        for (const pCode of r.perms) {
            const pId = permMap.get(pCode);
            if (pId) {
                await db('role_permission').insert({
                    id: randomUUID(),
                    role_id: roleId,
                    permission_id: pId,
                    created_at: now,
                });
            }
        }
    }

    // 5. Users (Password: Password123!)
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const users = [
        {
            id: USER_COORDINATOR_ID,
            email: 'coordinator@yourcargocontact.com',
            name: 'Sophie van Dijk',
            role_id: roleMap.get('Sea Freight Coordinator')!,
        },
        {
            id: USER_CUSTOMS_ID,
            email: 'customs@yourcargocontact.com',
            name: 'Lars de Boer',
            role_id: roleMap.get('Customs')!,
        },
        {
            id: USER_MANAGER_ID,
            email: 'manager@yourcargocontact.com',
            name: 'Willem Jansen',
            role_id: roleMap.get('Operations Manager')!,
        },
    ];

    for (const u of users) {
        await db('app_user').insert({
            ...u,
            workspace_id: WORKSPACE_ID,
            password_hash: passwordHash,
            is_active: true,
            created_by: USER_MANAGER_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        });
    }

    // 6. Master Data: Currencies
    const currencies = [
        { code: 'EUR', name: 'Euro', symbol: '€' },
        { code: 'USD', name: 'US Dollar', symbol: '$' },
        { code: 'GBP', name: 'British Pound', symbol: '£' },
        { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
        { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
        { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
    ];
    for (const c of currencies) {
        await db('currency').insert({
            id: randomUUID(),
            workspace_id: WORKSPACE_ID,
            ...c,
            created_by: USER_MANAGER_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        });
    }

    // 7. Master Data: Incoterms
    const incoterms = [
        { code: 'FOB', description: 'Free on Board (named port of shipment)' },
        { code: 'CIF', description: 'Cost, Insurance and Freight (named port of destination)' },
        { code: 'CFR', description: 'Cost and Freight (named port of destination)' },
        { code: 'EXW', description: 'Ex Works (named place of delivery)' },
        { code: 'FCA', description: 'Free Carrier (named place of delivery)' },
        { code: 'CPT', description: 'Carriage Paid To (named place of destination)' },
        { code: 'CIP', description: 'Carriage and Insurance Paid to' },
        { code: 'DAP', description: 'Delivered at Place (named place of destination)' },
        { code: 'DPU', description: 'Delivered at Place Unloaded' },
        { code: 'DDP', description: 'Delivered Duty Paid (named place of destination)' },
    ];
    const incotermMap = new Map<string, string>();
    for (const i of incoterms) {
        const id = randomUUID();
        incotermMap.set(i.code, id);
        await db('incoterm').insert({
            id,
            workspace_id: WORKSPACE_ID,
            ...i,
            created_by: USER_MANAGER_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        });
    }

    // 8. Master Data: 20 UN/LOCODE Ports
    const ports = [
        { un_locode: 'NLRTM', name: 'Rotterdam Port', country_code: 'NL' },
        { un_locode: 'NLAMS', name: 'Amsterdam Port', country_code: 'NL' },
        { un_locode: 'BEANR', name: 'Antwerp Port', country_code: 'BE' },
        { un_locode: 'DEHAM', name: 'Hamburg Port', country_code: 'DE' },
        { un_locode: 'DEBRE', name: 'Bremerhaven Port', country_code: 'DE' },
        { un_locode: 'GBLON', name: 'London Gateway Port', country_code: 'GB' },
        { un_locode: 'GBSOU', name: 'Southampton Port', country_code: 'GB' },
        { un_locode: 'FRLEH', name: 'Le Havre Port', country_code: 'FR' },
        { un_locode: 'CNSHA', name: 'Shanghai Port', country_code: 'CN' },
        { un_locode: 'CNNGB', name: 'Ningbo-Zhoushan Port', country_code: 'CN' },
        { un_locode: 'CNSZX', name: 'Shenzhen Port', country_code: 'CN' },
        { un_locode: 'CNNBO', name: 'Qingdao Port', country_code: 'CN' },
        { un_locode: 'HKHKG', name: 'Hong Kong Port', country_code: 'HK' },
        { un_locode: 'SGSIN', name: 'Singapore Port', country_code: 'SG' },
        { un_locode: 'JPTYO', name: 'Tokyo Port', country_code: 'JP' },
        { un_locode: 'JPYOK', name: 'Yokohama Port', country_code: 'JP' },
        { un_locode: 'USNYC', name: 'New York / New Jersey Port', country_code: 'US' },
        { un_locode: 'USLAX', name: 'Los Angeles Port', country_code: 'US' },
        { un_locode: 'AEJEA', name: 'Jebel Ali Port (Dubai)', country_code: 'AE' },
        { un_locode: 'SAJED', name: 'Jeddah Islamic Port', country_code: 'SA' },
    ];
    const portMap = new Map<string, string>();
    for (const p of ports) {
        const id = randomUUID();
        portMap.set(p.un_locode, id);
        await db('location').insert({
            id,
            workspace_id: WORKSPACE_ID,
            ...p,
            type: 'port',
            created_by: USER_MANAGER_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        });
    }

    // 9. Master Data: Carriers
    const carriers = [
        { name: 'Maersk Line', scac_code: 'MAEU', line_code: 'MSK' },
        { name: 'MSC Mediterranean Shipping Company', scac_code: 'MSCU', line_code: 'MSC' },
        { name: 'CMA CGM', scac_code: 'CMDU', line_code: 'CMA' },
        { name: 'Hapag-Lloyd', scac_code: 'HLCU', line_code: 'HAPAG' },
        { name: 'Ocean Network Express (ONE)', scac_code: 'ONEY', line_code: 'ONE' },
        { name: 'COSCO Shipping Lines', scac_code: 'COSU', line_code: 'COSCO' },
    ];
    const carrierMap = new Map<string, string>();
    for (const c of carriers) {
        const id = randomUUID();
        carrierMap.set(c.name, id);
        await db('carrier').insert({
            id,
            workspace_id: WORKSPACE_ID,
            ...c,
            created_by: USER_MANAGER_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        });
    }

    // 10. Master Data: 10 Clients
    const clients = [
        { name: 'Rotterdam Tech Logistics B.V.', code: 'RTL-001', type: 'customer', country: 'NL' },
        { name: 'Shanghai Electronics Co. Ltd', code: 'SEC-002', type: 'shipper', country: 'CN' },
        { name: 'Amsterdam Green Energy Group', code: 'AGE-003', type: 'customer', country: 'NL' },
        { name: 'Ningbo Solar Panel Manufacturing', code: 'NSP-004', type: 'shipper', country: 'CN' },
        { name: 'Bayer CropScience NL', code: 'BCS-005', type: 'shipper', country: 'NL' },
        { name: 'Singapore Agritech Hub Pte', code: 'SAH-006', type: 'consignee', country: 'SG' },
        { name: 'Friesland Dairy Export B.V.', code: 'FDE-007', type: 'shipper', country: 'NL' },
        { name: 'Jebel Ali Cold Storage LLC', code: 'JAC-008', type: 'consignee', country: 'AE' },
        { name: 'Dutch Distribution Center B.V.', code: 'DDC-009', type: 'customer', country: 'NL' },
        { name: 'Kyoto High-Tech Instruments', code: 'KHT-010', type: 'shipper', country: 'JP' },
    ];
    const clientMap = new Map<string, string>();
    for (const cl of clients) {
        const id = randomUUID();
        clientMap.set(cl.name, id);
        await db('client').insert({
            id,
            workspace_id: WORKSPACE_ID,
            ...cl,
            created_by: USER_MANAGER_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        });
    }

    // 11. Core Dossier 1: Sea Import (Draft / Release Pending)
    const file1Id = randomUUID();
    await db('freight_file').insert({
        id: file1Id,
        workspace_id: WORKSPACE_ID,
        file_no: 'SF-2026-00001',
        mode: 'sea',
        direction: 'import',
        status: 'ReleasePending',
        customer_id: clientMap.get('Rotterdam Tech Logistics B.V.'),
        shipper_id: clientMap.get('Shanghai Electronics Co. Ltd'),
        consignee_id: clientMap.get('Rotterdam Tech Logistics B.V.'),
        carrier_id: carrierMap.get('Maersk Line'),
        pol_id: portMap.get('CNSHA'),
        pod_id: portMap.get('NLRTM'),
        incoterm_id: incotermMap.get('FOB'),
        vessel: 'Madrid Maersk',
        voyage: '2601W',
        etd: new Date(Date.now() - 14 * 24 * 3600 * 1000),
        eta: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        special_handling: 'NONE',
        special_status: 'GREEN',
        free_time_days: 5,
        declaration_status: 'submitted',
        declaration_id: 'DMS-2026-098123',
        mrn: '26NL90823419028371',
        total_cost: 2450.0,
        currency: 'EUR',
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    const c1Id = randomUUID();
    await db('freight_container').insert({
        id: c1Id,
        workspace_id: WORKSPACE_ID,
        freight_file_id: file1Id,
        container_number: 'MSKU9082341',
        type: '40HC',
        seal_number: 'MSK891273',
        tare_weight_kg: 3850.0,
        gross_weight_kg: 22350.0,
        vgm_kg: 22350.0,
        vgm_method: 'method_1',
        vgm_submitted_at: new Date(Date.now() - 15 * 24 * 3600 * 1000),
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    await db('bill_of_lading').insert({
        id: randomUUID(),
        workspace_id: WORKSPACE_ID,
        freight_file_id: file1Id,
        type: 'MBL',
        bl_number: 'MAEU982340192',
        issue_date: new Date(Date.now() - 14 * 24 * 3600 * 1000),
        telex_release: true,
        original_received: false,
        released_at: new Date(Date.now() - 1 * 24 * 3600 * 1000),
        draft_approved: true,
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    await db('drayage_order').insert({
        id: randomUUID(),
        workspace_id: WORKSPACE_ID,
        freight_file_id: file1Id,
        container_id: c1Id,
        order_number: 'TR-2026-00101',
        type: 'import_delivery',
        terminal_name: 'APM Terminals Maasvlakte II',
        facility_address: 'Distripark Maasvlakte, 3199 LK Rotterdam',
        trucking_company: 'Vos Transport B.V.',
        driver_name: 'Jan de Vries',
        truck_plate: '78-BZX-9',
        status: 'draft',
        scheduled_at: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    // 12. Core Dossier 2: Sea Import (Arrived — Demurrage Watch < 48 hours remaining)
    const file2Id = randomUUID();
    const freeTimeExpiry = new Date(Date.now() + 36 * 3600 * 1000); // 36 hours from now
    await db('freight_file').insert({
        id: file2Id,
        workspace_id: WORKSPACE_ID,
        file_no: 'SF-2026-00002',
        mode: 'sea',
        direction: 'import',
        status: 'Arrived',
        customer_id: clientMap.get('Amsterdam Green Energy Group'),
        shipper_id: clientMap.get('Ningbo Solar Panel Manufacturing'),
        consignee_id: clientMap.get('Amsterdam Green Energy Group'),
        carrier_id: carrierMap.get('MSC Mediterranean Shipping Company'),
        pol_id: portMap.get('CNNGB'),
        pod_id: portMap.get('NLRTM'),
        incoterm_id: incotermMap.get('CIF'),
        vessel: 'MSC Oscar',
        voyage: 'MO2603',
        etd: new Date(Date.now() - 20 * 24 * 3600 * 1000),
        eta: new Date(Date.now() - 12 * 3600 * 1000),
        ata: new Date(Date.now() - 12 * 3600 * 1000),
        special_handling: 'NONE',
        special_status: 'GREEN',
        free_time_days: 5,
        declaration_status: 'accepted',
        declaration_id: 'DMS-2026-077431',
        mrn: '26NL88129304910283',
        total_cost: 3800.0,
        currency: 'EUR',
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    await db('freight_container').insert([
        {
            id: randomUUID(),
            workspace_id: WORKSPACE_ID,
            freight_file_id: file2Id,
            container_number: 'MEDU1298471',
            type: '40HC',
            seal_number: 'MSC981273',
            tare_weight_kg: 3900.0,
            gross_weight_kg: 25400.0,
            vgm_kg: 25400.0,
            vgm_method: 'method_1',
            vgm_submitted_at: new Date(Date.now() - 21 * 24 * 3600 * 1000),
            created_by: USER_COORDINATOR_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        },
        {
            id: randomUUID(),
            workspace_id: WORKSPACE_ID,
            freight_file_id: file2Id,
            container_number: 'MEDU5928172',
            type: '40HC',
            seal_number: 'MSC981274',
            tare_weight_kg: 3900.0,
            gross_weight_kg: 24700.0,
            vgm_kg: 24700.0,
            vgm_method: 'method_1',
            vgm_submitted_at: new Date(Date.now() - 21 * 24 * 3600 * 1000),
            created_by: USER_COORDINATOR_ID,
            created_at: now,
            updated_at: now,
            version: 1,
        },
    ]);

    await db('exception_case').insert({
        id: randomUUID(),
        workspace_id: WORKSPACE_ID,
        freight_file_id: file2Id,
        gate_code: 'CONTAINER_RELEASE',
        type: 'demurrage_risk',
        severity: 'warn',
        status: 'Open',
        title: 'Demurrage clock active (36h free time remaining)',
        description: `Vessel MSC Oscar arrived at ECT Delta. Portbase container release pending. Free time expires at ${freeTimeExpiry.toISOString()}.`,
        assignee_id: USER_COORDINATOR_ID,
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    // 13. Core Dossier 3: Sea Export (Booked — IMDG Dangerous Goods)
    const file3Id = randomUUID();
    await db('freight_file').insert({
        id: file3Id,
        workspace_id: WORKSPACE_ID,
        file_no: 'SF-2026-00003',
        mode: 'sea',
        direction: 'export',
        status: 'Booked',
        customer_id: clientMap.get('Bayer CropScience NL'),
        shipper_id: clientMap.get('Bayer CropScience NL'),
        consignee_id: clientMap.get('Singapore Agritech Hub Pte'),
        carrier_id: carrierMap.get('CMA CGM'),
        pol_id: portMap.get('NLRTM'),
        pod_id: portMap.get('SGSIN'),
        incoterm_id: incotermMap.get('CPT'),
        vessel: 'CMA CGM Palais Royal',
        voyage: '0PR26E',
        etd: new Date(Date.now() + 5 * 24 * 3600 * 1000),
        vgm_cutoff: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        gate_cutoff: new Date(Date.now() + 4 * 24 * 3600 * 1000),
        doc_cutoff: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        special_handling: 'IMDG',
        special_status: 'GREEN',
        free_time_days: 7,
        total_cost: 1950.0,
        currency: 'EUR',
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    await db('freight_container').insert({
        id: randomUUID(),
        workspace_id: WORKSPACE_ID,
        freight_file_id: file3Id,
        container_number: 'CMAU7812903',
        type: '20DV',
        seal_number: 'CMA110294',
        tare_weight_kg: 2200.0,
        gross_weight_kg: 14600.0,
        vgm_kg: 14600.0,
        vgm_method: 'method_1',
        vgm_submitted_at: new Date(Date.now() - 1 * 24 * 3600 * 1000),
        imdg_class: '3',
        un_number: 'UN1993',
        packing_group: 'II',
        proper_shipping_name: 'FLAMMABLE LIQUID, N.O.S. (PESTICIDE MIXTURE)',
        msds_attached: true,
        dg_declaration_attached: true,
        carrier_dg_accepted: true,
        dg_segregation_requirements: 'Segregation reviewed; no additional separation required',
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    // 14. Core Dossier 4: Sea Export (VgmSiSubmitted — Reefer Cargo)
    const file4Id = randomUUID();
    await db('freight_file').insert({
        id: file4Id,
        workspace_id: WORKSPACE_ID,
        file_no: 'SF-2026-00004',
        mode: 'sea',
        direction: 'export',
        status: 'VgmSiSubmitted',
        customer_id: clientMap.get('Friesland Dairy Export B.V.'),
        shipper_id: clientMap.get('Friesland Dairy Export B.V.'),
        consignee_id: clientMap.get('Jebel Ali Cold Storage LLC'),
        carrier_id: carrierMap.get('Hapag-Lloyd'),
        pol_id: portMap.get('NLRTM'),
        pod_id: portMap.get('AEJEA'),
        incoterm_id: incotermMap.get('DAP'),
        vessel: 'Al Jmeliyah',
        voyage: 'HL2605E',
        etd: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        vgm_cutoff: new Date(Date.now() + 1 * 24 * 3600 * 1000),
        special_handling: 'REEFER',
        special_status: 'GREEN',
        free_time_days: 7,
        total_cost: 4200.0,
        currency: 'EUR',
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    await db('freight_container').insert({
        id: randomUUID(),
        workspace_id: WORKSPACE_ID,
        freight_file_id: file4Id,
        container_number: 'HLCU4901284',
        type: '40RF',
        seal_number: 'HL981290',
        tare_weight_kg: 4400.0,
        gross_weight_kg: 28450.0,
        vgm_kg: 28450.0,
        vgm_method: 'method_1',
        vgm_submitted_at: new Date(Date.now() - 4 * 3600 * 1000),
        temperature_setpoint_c: -18.0,
        ventilation_cbm_hr: 15.0,
        humidity_percent: 65.0,
        pre_trip_inspection_passed: true,
        reefer_monitoring_confirmed: true,
        created_by: USER_COORDINATOR_ID,
        created_at: now,
        updated_at: now,
        version: 1,
    });

    console.log('✅ Sea Freight Foundation Seed completed successfully!');
    console.log('   - 1 Workspace, 3 Authenticated Users, 5 Roles & Permissions');
    console.log('   - 10 Clients, 20 UN/LOCODE Ports, 10 Incoterms, 6 Carriers');
    console.log('   - 4 Operational Sea Freight dossiers (Import & Export with IMDG/Reefer)');
}

if (process.argv[1]?.includes('01_sea_freight_seed')) {
    seedDatabase()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ Seeding error:', err);
            process.exit(1);
        });
}
