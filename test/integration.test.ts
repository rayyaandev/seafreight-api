import { createApp } from '../src/app.js';
import type { Server } from 'http';

async function runTests() {
    console.log('🧪 Starting Sea Freight API Verification Tests...\n');

    const app = createApp();
    const server: Server = app.listen(4999);
    const baseUrl = 'http://localhost:4999';

    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, testName: string, detail?: any) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${testName}`, detail || '');
            failed++;
        }
    }

    try {
        // 1. Health check
        const healthRes = await fetch(`${baseUrl}/health`);
        const healthData = await healthRes.json();
        assert(healthRes.status === 200, 'Health check status 200');
        assert(healthData.data.database === 'connected', 'Database connected');

        // 2. Metrics endpoint
        const metricsRes = await fetch(`${baseUrl}/v1/freight/metrics`);
        const metricsData = await metricsRes.json();
        assert(metricsRes.status === 200, 'GET /v1/freight/metrics status 200');
        assert(Number(metricsData.data.total_active) >= 4, 'Metrics returns at least 4 active sea files');

        // 3. List Freight Files
        const listRes = await fetch(`${baseUrl}/v1/freight/files?mode=sea`);
        const listData = await listRes.json();
        assert(listRes.status === 200, 'GET /v1/freight/files status 200');
        assert(Array.isArray(listData.data), 'Returns files array');
        assert(listData.page.total >= 4, 'Pagination total reflects seeded count');

        const exportFile = listData.data.find((f: any) => f.human_id === 'SF-2026-00004');
        assert(Boolean(exportFile), 'Found seeded file SF-2026-00004');

        // 4. Get File Dossier
        const dossierRes = await fetch(`${baseUrl}/v1/freight/files/${exportFile.id}`);
        const dossierData = await dossierRes.json();
        assert(dossierRes.status === 200, 'GET /v1/freight/files/:id dossier status 200');
        assert(dossierData.data.containers.length > 0, 'Dossier includes child containers');
        assert(
            dossierData.data.compliance_evaluation.status === 'green',
            'Reefer compliance evaluates to GREEN'
        );

        // 5. Test State Machine Hard Gate: Illegal Transition (draft -> delivered)
        const illegalTransitionRes = await fetch(`${baseUrl}/v1/freight/files/${exportFile.id}/transition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target_status: 'delivered',
                version: exportFile.version,
            }),
        });
        const illegalData = await illegalTransitionRes.json();
        assert(
            illegalTransitionRes.status === 400 && illegalData.error.code === 'INVALID_TRANSITION',
            'Illegal state transition rejected with 400 INVALID_TRANSITION'
        );

        // 6. Test Valid Transition: vgm_si_submitted -> loaded
        const validTransitionRes = await fetch(`${baseUrl}/v1/freight/files/${exportFile.id}/transition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target_status: 'loaded',
                version: exportFile.version,
                reason: 'All containers gated in and loaded on Al Jmeliyah',
            }),
        });
        const validData = await validTransitionRes.json();
        assert(
            validTransitionRes.status === 200 && validData.data.file.status === 'loaded',
            'Valid state transition to loaded succeeded and version incremented'
        );

        // 7. Test Gate Violation: Import file without customs release cannot move to cleared
        const importFile1 = listData.data.find((f: any) => f.human_id === 'SF-2026-00001');
        // First transition from release_pending -> arrived (allowed)
        const arrivedRes = await fetch(`${baseUrl}/v1/freight/files/${importFile1.id}/transition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target_status: 'arrived',
                version: importFile1.version,
            }),
        });
        const arrivedData = await arrivedRes.json();
        assert(arrivedRes.status === 200, 'Import file transitioned to arrived');

        // Now attempt arrived -> cleared (should be blocked because customs_declaration_status is 'submitted', not 'accepted')
        const blockedImportRes = await fetch(`${baseUrl}/v1/freight/files/${importFile1.id}/transition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target_status: 'cleared',
                version: arrivedData.data.file.version,
            }),
        });
        const blockedData = await blockedImportRes.json();
        assert(
            blockedImportRes.status === 422 && blockedData.error.code === 'CUSTOMS_RELEASE_GATE_FAILED',
            'Un-cleared customs declaration gate blocked transition with 422 CUSTOMS_RELEASE_GATE_FAILED'
        );

        // 8. Create new file with automatic human_id generation
        const createRes = await fetch(`${baseUrl}/v1/freight/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'sea',
                direction: 'import',
                shipper_name: 'Kyoto Electronics Co.',
                consignee_name: 'Dutch Distribution Center B.V.',
                pol: 'JPOSA',
                pod: 'NLRTM',
                carrier_name: 'ONE (Ocean Network Express)',
                special_handling_type: 'none',
                currency: 'EUR',
            }),
        });
        const createData = await createRes.json();
        assert(createRes.status === 201, 'POST /v1/freight/files created file with 201');
        assert(createData.data.human_id.startsWith('SF-'), 'Server generated human_id formatted as SF-YYYY-NNNNN');

        // 9. Add Drayage Transport Order
        const drayageRes = await fetch(`${baseUrl}/v1/freight/files/${createData.data.id}/drayage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'import_delivery',
                terminal_name: 'ECT Delta Terminal',
                facility_address: 'Europaweg 875, 3199 LD Rotterdam',
                trucking_company: 'Mainport Trucking B.V.',
            }),
        });
        const drayageData = await drayageRes.json();
        assert(drayageRes.status === 201, 'POST /v1/freight/files/:id/drayage created transport order');
        assert(drayageData.data.order_number.startsWith('TR-'), 'Server generated transport order number TR-YYYY-NNNNN');
    } catch (err) {
        console.error('Test execution exception:', err);
        failed++;
    } finally {
        server.close();
        console.log(`\n📊 Verification Summary: ${passed} passed, ${failed} failed.\n`);
        process.exit(failed > 0 ? 1 : 0);
    }
}

runTests();
