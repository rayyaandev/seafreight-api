import { createApp } from '../src/app.js';
import type { Server } from 'http';

async function runFreightTestSuite() {
    console.log('🧪 Starting Freight Dossier & Child Entities Test Suite...\n');

    const app = createApp();
    const server: Server = app.listen(4888);
    const baseUrl = 'http://localhost:4888';

    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, testName: string, detail?: unknown) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${testName}`, detail || '');
            failed++;
        }
    }

    try {
        // --------------------------------------------------------------------
        // 0. Login as Coordinator
        // --------------------------------------------------------------------
        const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'coordinator@yourcargocontact.com',
                password: 'Password123!',
            }),
        });
        const loginData = await loginRes.json();
        const token = loginData.data.access_token;
        const authHeaders = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        // --------------------------------------------------------------------
        // 1. Metrics Endpoint
        // --------------------------------------------------------------------
        console.log('--- 1. Freight Metrics ---');
        const metricsRes = await fetch(`${baseUrl}/v1/freight/metrics`, { headers: authHeaders });
        const metricsData = await metricsRes.json();
        assert(metricsRes.status === 200, 'GET /v1/freight/metrics returns status 200');
        assert(Number(metricsData.data.total_active) >= 4, 'Metrics returns at least 4 active files');

        // --------------------------------------------------------------------
        // 2. Freight Files Listing & Filtering
        // --------------------------------------------------------------------
        console.log('\n--- 2. List & Filter Dossiers ---');
        const listRes = await fetch(`${baseUrl}/v1/freight/files?mode=sea&direction=import`, {
            headers: authHeaders,
        });
        const listData = await listRes.json();
        assert(listRes.status === 200, 'GET /v1/freight/files returns status 200');
        assert(Array.isArray(listData.data), 'Returns files array');
        assert(listData.page.total >= 1, 'Pagination total reflects filtered records');

        // Search filter test
        const searchRes = await fetch(`${baseUrl}/v1/freight/files?q=SF-2026-00001`, {
            headers: authHeaders,
        });
        const searchData = await searchRes.json();
        assert(searchRes.status === 200 && searchData.data.length >= 1, 'Search filter ?q=SF-2026-00001 finds dossier');

        // --------------------------------------------------------------------
        // 3. Dossier Creation
        // --------------------------------------------------------------------
        console.log('\n--- 3. Dossier Creation & Retrieval ---');
        const createRes = await fetch(`${baseUrl}/v1/freight/files`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                mode: 'sea',
                direction: 'import',
                vessel: 'MSC Grandiosa',
                voyage: '2026W01',
                free_time_days: 7,
                special_handling: 'REEFER',
            }),
        });
        const createData = await createRes.json();
        assert(createRes.status === 201, 'POST /v1/freight/files creates file with 201');
        assert(createData.data.file_no.startsWith('SF-2026-'), 'Assigns sequential SF-2026-XXXXX file number');
        assert(createData.data.status === 'Draft', 'Initial status is Draft');
        assert(createData.data.special_status === 'ORANGE', 'Initial Reefer special status is ORANGE');

        const fileId = createData.data.id;
        let fileVersion = createData.data.version;

        // Retrieve Full Dossier
        const getRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, { headers: authHeaders });
        const getData = await getRes.json();
        assert(getRes.status === 200, 'GET /v1/freight/files/:id returns complete dossier');
        assert(Array.isArray(getData.data.containers), 'Dossier contains containers array');
        assert(Array.isArray(getData.data.lines), 'Dossier contains cargo lines array');
        assert(Boolean(getData.data.gates_summary), 'Dossier contains live gates evaluation');

        // --------------------------------------------------------------------
        // 4. Concurrency & Optimistic Locking
        // --------------------------------------------------------------------
        console.log('\n--- 4. Concurrency & Version Optimistic Locking ---');

        // Outdated version update (should fail with 409 Conflict)
        const staleUpdateRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({
                version: 999, // Stale version
                vessel: 'Stale Vessel Update',
            }),
        });
        const staleUpdateData = await staleUpdateRes.json();
        assert(staleUpdateRes.status === 409 && staleUpdateData.error.code === 'CONFLICT', 'Stale version update rejected with 409 CONFLICT');

        // Valid version update
        const validUpdateRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({
                version: fileVersion,
                vessel: 'MSC Grandiosa II',
            }),
        });
        const validUpdateData = await validUpdateRes.json();
        assert(validUpdateRes.status === 200, 'Valid update returns status 200');
        assert(validUpdateData.data.version === fileVersion + 1, 'Version counter increments to version + 1');
        assert(validUpdateData.data.vessel === 'MSC Grandiosa II', 'Vessel name updated');
        fileVersion = validUpdateData.data.version;

        // --------------------------------------------------------------------
        // 5. Gate Evaluation Endpoint
        // --------------------------------------------------------------------
        console.log('\n--- 5. Real-Time Gate Evaluation ---');
        const gatesRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/gates`, { headers: authHeaders });
        const gatesData = await gatesRes.json();
        assert(gatesRes.status === 200, 'GET /v1/freight/files/:id/gates returns status 200');
        assert(gatesData.data.gates.length === 6, 'Evaluates all 6 business rule gates');
        assert(gatesData.data.allPassed === false, 'Fresh file accurately flags incomplete gates');

        // --------------------------------------------------------------------
        // 6. Child Entities: Containers CRUD
        // --------------------------------------------------------------------
        console.log('\n--- 6. Containers Lifecycle ---');
        const addContainerRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/containers`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                container_number: 'MSCU9876543',
                type: '40RF',
                seal_number: 'SL-888999',
                tare_weight_kg: 4200,
                cargo_weight_kg: 21000,
                vgm_kg: 25200,
                temperature_setpoint_c: -18.5,
                humidity_percent: 85,
                pre_trip_inspection_passed: true,
            }),
        });
        const addContainerData = await addContainerRes.json();
        assert(addContainerRes.status === 201, 'POST /v1/freight/files/:id/containers creates container');
        assert(addContainerData.data.container_number === 'MSCU9876543', 'Container number matches');
        const containerId = addContainerData.data.id;

        // Check that Reefer special status transitioned to GREEN
        const updatedDossierRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, { headers: authHeaders });
        const updatedDossierData = await updatedDossierRes.json();
        assert(updatedDossierData.data.special_status === 'GREEN', 'Special status automatically evaluated to GREEN');

        // Delete Container
        const delContainerRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/containers/${containerId}`, {
            method: 'DELETE',
            headers: authHeaders,
        });
        assert(delContainerRes.status === 200, 'DELETE /v1/freight/files/:id/containers/:containerId deletes container');

        // --------------------------------------------------------------------
        // 7. Child Entities: Cargo Lines, BOL, Documents, Notes, Drayage, Charges
        // --------------------------------------------------------------------
        console.log('\n--- 7. Other Child Entities (Lines, BOL, Docs, Notes, Drayage, Charges) ---');

        // Add Cargo Line
        const addLineRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/lines`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                description: 'Frozen Seafood (Shrimp & Salmon)',
                quantity: 1200,
                packages: 1200,
                weight_kg: 21000,
                volume_cbm: 58.5,
                value_amount: 145000,
                currency: 'EUR',
            }),
        });
        const addLineData = await addLineRes.json();
        assert(addLineRes.status === 201, 'POST /v1/freight/files/:id/lines adds cargo line');
        const lineId = addLineData.data.id;

        // Delete Cargo Line
        const delLineRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/lines/${lineId}`, {
            method: 'DELETE',
            headers: authHeaders,
        });
        assert(delLineRes.status === 200, 'DELETE /v1/freight/files/:id/lines/:lineId deletes cargo line');

        // Add Bill of Lading
        const addBolRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/bills-of-lading`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                type: 'MBL',
                bl_number: 'MSCU-2026-9911',
                telex_release: true,
                draft_approved: true,
            }),
        });
        assert(addBolRes.status === 201, 'POST /v1/freight/files/:id/bills-of-lading adds B/L');

        // Add Document
        const addDocRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/documents`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                doc_type: 'commercial_invoice',
                file_name: 'invoice_2026_seafood.pdf',
                storage_key: 's3://docs/invoice_2026_seafood.pdf',
                mime_type: 'application/pdf',
                file_size_bytes: 204800,
            }),
        });
        const addDocData = await addDocRes.json();
        assert(addDocRes.status === 201, 'POST /v1/freight/files/:id/documents attaches document');
        const docId = addDocData.data.id;

        // Delete Document
        const delDocRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/documents/${docId}`, {
            method: 'DELETE',
            headers: authHeaders,
        });
        assert(delDocRes.status === 200, 'DELETE /v1/freight/files/:id/documents/:docId deletes document');

        // Add Note
        const addNoteRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/notes`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                note_text: 'VIP Customer - Priority customs clearance requested upon arrival',
                show_on_open: true,
            }),
        });
        assert(addNoteRes.status === 201, 'POST /v1/freight/files/:id/notes adds operational note');

        // Add Drayage Order
        const addDrayageRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/drayage-orders`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                type: 'import_delivery',
                terminal_name: 'APM Terminals Maasvlakte II',
                facility_address: 'Europaweg 900, 3199 LC Rotterdam',
                trucking_company: 'Rotterdam Drayage B.V.',
            }),
        });
        assert(addDrayageRes.status === 201, 'POST /v1/freight/files/:id/drayage-orders creates transport order');

        // Add Milestone
        const addMilestoneRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/milestones`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                milestone_type: 'customs_cleared',
                source: 'system',
            }),
        });
        assert(addMilestoneRes.status === 201, 'POST /v1/freight/files/:id/milestones records transport milestone');

        // Add Charge
        const addChargeRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/charges`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                line_type: 'sell',
                service_name: 'Ocean Freight Rotterdam -> Shanghai',
                amount: 2450.0,
                currency: 'EUR',
            }),
        });
        const addChargeData = await addChargeRes.json();
        assert(addChargeRes.status === 201, 'POST /v1/freight/files/:id/charges creates billing line');
        const chargeId = addChargeData.data.id;

        // Delete Charge
        const delChargeRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/charges/${chargeId}`, {
            method: 'DELETE',
            headers: authHeaders,
        });
        assert(delChargeRes.status === 200, 'DELETE /v1/freight/files/:id/charges/:chargeId deletes billing line');

        // --------------------------------------------------------------------
        // 8. Special Handling Override
        // --------------------------------------------------------------------
        console.log('\n--- 8. Special Handling Override ---');
        const latestDossierRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, { headers: authHeaders });
        const latestDossierData = await latestDossierRes.json();
        const currentVersion = latestDossierData.data.version;

        const overrideRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}/special-handling`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                version: currentVersion,
                special_handling: 'IMDG',
                special_status: 'ORANGE',
                reason: 'Awaiting shipper MSDS confirmation sheet',
            }),
        });
        const overrideData = await overrideRes.json();
        assert(overrideRes.status === 200, 'POST /v1/freight/files/:id/special-handling updates override status');
        assert(overrideData.data.special_handling === 'IMDG', 'Special handling type updated to IMDG');
        assert(overrideData.data.special_status === 'ORANGE', 'Special status set to ORANGE');
    } catch (err) {
        console.error('Test execution error:', err);
        failed++;
    } finally {
        server.close();
        console.log(`\n======================================================`);
        console.log(`📊 Freight Dossier & Child Entities Summary: ${passed} passed, ${failed} failed.`);
        console.log(`======================================================\n`);
        process.exit(failed > 0 ? 1 : 0);
    }
}

runFreightTestSuite();
