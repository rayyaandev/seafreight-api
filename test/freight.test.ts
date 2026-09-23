import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import type { Server } from 'http';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

const PORT = 4888;
const baseUrl = `http://localhost:${PORT}`;

let server: Server;
let token: string;
let headers: Record<string, string>;

beforeAll(async () => {
  const app = createApp();
  server = app.listen(PORT);

  // Login as Coordinator
  const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'coordinator@yourcargocontact.com',
      password: 'Password123!',
    }),
  });
  const loginData = await json(loginRes);
  token = loginData.data.access_token;
  headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
});

afterAll(() => {
  server.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Freight Dossier & Child Entities', () => {
  // Shared state across sequential tests
  let fileId: string;
  let fileVersion: number;

  // ── 1. Metrics ──────────────────────────────────────────────────────────

  describe('1. Freight Metrics', () => {
    it('GET /v1/freight/metrics returns status 200', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/metrics`, { headers });
      expect(res.status).toBe(200);
    });

    it('Metrics returns at least 4 active files', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/metrics`, { headers });
      const data = await json(res);
      expect(Number(data.data.total_active)).toBeGreaterThanOrEqual(4);
    });

    it('Metrics returns complete KPI tiles and breakdown per Implementation Guide', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/metrics`, { headers });
      const data = await json(res);
      expect(data.data).toHaveProperty('tiles');
      expect(data.data.tiles).toHaveProperty('open_files');
      expect(data.data.tiles).toHaveProperty('awaiting_release');
      expect(data.data.tiles).toHaveProperty('arriving_this_week');
      expect(data.data.tiles).toHaveProperty('demurrage_at_risk');
      expect(data.data.tiles).toHaveProperty('blocked_by_gate');
      expect(data.data.tiles).toHaveProperty('open_exceptions');

      expect(data.data).toHaveProperty('breakdown');
      expect(data.data.breakdown).toHaveProperty('by_direction');
      expect(data.data.breakdown).toHaveProperty('by_status');
      expect(data.data.breakdown).toHaveProperty('by_special_status');

      expect(data.data).toHaveProperty('recent_alerts');
      expect(Array.isArray(data.data.recent_alerts)).toBe(true);
    });
  });

  // ── 2. List & Filter ───────────────────────────────────────────────────

  describe('2. List & Filter Dossiers', () => {
    it('GET /v1/freight/files returns status 200 with files array', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files?mode=sea&direction=import`, { headers });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data).toBeInstanceOf(Array);
    });

    it('Pagination total reflects filtered records', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files?mode=sea&direction=import`, { headers });
      const data = await json(res);
      expect(data.page.total).toBeGreaterThanOrEqual(1);
    });

    it('Search filter ?q=SF-2026-00001 finds dossier', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files?q=SF-2026-00001`, { headers });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 3. Dossier Creation & Retrieval ─────────────────────────────────────

  describe('3. Dossier Creation & Retrieval', () => {
    it('POST /v1/freight/files creates file with 201', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'sea',
          direction: 'import',
          vessel: 'MSC Grandiosa',
          voyage: '2026W01',
          free_time_days: 7,
          special_handling: 'REEFER',
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(201);
      expect(data.data.file_no).toMatch(/^SF-2026-/);
      expect(data.data.status).toBe('Draft');
      expect(data.data.special_status).toBe('RED');

      fileId = data.data.id;
      fileVersion = data.data.version;
    });

    it('GET /v1/freight/files/:id returns complete dossier', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, { headers });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data.containers).toBeInstanceOf(Array);
      expect(data.data.lines).toBeInstanceOf(Array);
      expect(data.data.gates_summary).toBeTruthy();
    });
  });

  // ── 4. Concurrency & Optimistic Locking ─────────────────────────────────

  describe('4. Concurrency & Version Optimistic Locking', () => {
    it('Stale version update rejected with 409 CONFLICT', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ version: 999, vessel: 'Stale Vessel Update' }),
      });
      const data = await json(res);
      expect(res.status).toBe(409);
      expect(data.error.code).toBe('CONFLICT');
    });

    it('Valid update returns 200 with incremented version', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ version: fileVersion, vessel: 'MSC Grandiosa II' }),
      });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data.version).toBe(fileVersion + 1);
      expect(data.data.vessel).toBe('MSC Grandiosa II');

      fileVersion = data.data.version;
    });
  });

  // ── 5. Real-Time Gate Evaluation ────────────────────────────────────────

  describe('5. Real-Time Gate Evaluation', () => {
    it('GET /v1/freight/files/:id/gates returns status 200', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/gates`, { headers });
      expect(res.status).toBe(200);
    });

    it('Evaluates all 6 business rule gates', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/gates`, { headers });
      const data = await json(res);
      expect(data.data.gates).toHaveLength(6);
    });

    it('Fresh file accurately flags incomplete gates', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/gates`, { headers });
      const data = await json(res);
      expect(data.data.allPassed).toBe(false);
    });
  });

  // ── 6. Containers Lifecycle ─────────────────────────────────────────────

  describe('6. Containers Lifecycle', () => {
    let containerId: string;

    it('POST /v1/freight/files/:id/containers creates container', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/containers`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          container_number: 'MSCU9876543',
          type: '40RF',
          seal_number: 'SL-888999',
          tare_weight_kg: 4200,
          cargo_weight_kg: 21000,
          vgm_kg: 25200,
          temperature_setpoint_c: -18.5,
          ventilation_cbm_hr: 0,
          humidity_percent: 85,
          pre_trip_inspection_passed: true,
          reefer_monitoring_confirmed: true,
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(201);
      expect(data.data.container_number).toBe('MSCU9876543');

      containerId = data.data.id;
    });

    it('Special status automatically evaluated to GREEN after container added', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, { headers });
      const data = await json(res);
      expect(data.data.special_status).toBe('GREEN');
    });

    it('DELETE /v1/freight/files/:id/containers/:containerId deletes container', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/containers/${containerId}`, {
        method: 'DELETE',
        headers,
      });
      expect(res.status).toBe(200);
    });
  });

  // ── 7. Other Child Entities ─────────────────────────────────────────────

  describe('7. Other Child Entities (Lines, BOL, Docs, Notes, Drayage, Charges)', () => {
    let lineId: string;
    let docId: string;
    let chargeId: string;

    it('POST /v1/freight/files/:id/lines adds cargo line', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/lines`, {
        method: 'POST',
        headers,
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
      const data = await json(res);
      expect(res.status).toBe(201);

      lineId = data.data.id;
    });

    it('DELETE /v1/freight/files/:id/lines/:lineId deletes cargo line', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/lines/${lineId}`, {
        method: 'DELETE',
        headers,
      });
      expect(res.status).toBe(200);
    });

    it('POST /v1/freight/files/:id/bills-of-lading adds B/L', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/bills-of-lading`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'MBL',
          bl_number: 'MSCU-2026-9911',
          telex_release: true,
          draft_approved: true,
        }),
      });
      expect(res.status).toBe(201);
    });

    it('POST /v1/freight/files/:id/documents attaches document', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/documents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          doc_type: 'commercial_invoice',
          file_name: 'invoice_2026_seafood.pdf',
          storage_key: 's3://docs/invoice_2026_seafood.pdf',
          mime_type: 'application/pdf',
          file_size_bytes: 204800,
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(201);

      docId = data.data.id;
    });

    it('DELETE /v1/freight/files/:id/documents/:docId deletes document', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/documents/${docId}`, {
        method: 'DELETE',
        headers,
      });
      expect(res.status).toBe(200);
    });

    it('POST /v1/freight/files/:id/notes adds operational note', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          note_text: 'VIP Customer - Priority customs clearance requested upon arrival',
          show_on_open: true,
        }),
      });
      expect(res.status).toBe(201);
    });

    it('POST /v1/freight/files/:id/drayage-orders creates transport order', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/drayage-orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'import_delivery',
          terminal_name: 'APM Terminals Maasvlakte II',
          facility_address: 'Europaweg 900, 3199 LC Rotterdam',
          trucking_company: 'Rotterdam Drayage B.V.',
        }),
      });
      expect(res.status).toBe(201);
    });

    it('POST /v1/freight/files/:id/milestones records transport milestone', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/milestones`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          milestone_type: 'customs_cleared',
          source: 'system',
        }),
      });
      expect(res.status).toBe(201);
    });

    it('POST /v1/freight/files/:id/charges creates billing line', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/charges`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          line_type: 'sell',
          service_name: 'Ocean Freight Rotterdam -> Shanghai',
          amount: 2450.0,
          currency: 'EUR',
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(201);

      chargeId = data.data.id;
    });

    it('DELETE /v1/freight/files/:id/charges/:chargeId deletes billing line', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/charges/${chargeId}`, {
        method: 'DELETE',
        headers,
      });
      expect(res.status).toBe(200);
    });
  });

  // ── 8. Special Handling Override ─────────────────────────────────────────

  describe('8. Special Handling Override', () => {
    it('POST /v1/freight/files/:id/special-handling recomputes status', async () => {
      // Fetch latest version
      const latestRes = await fetch(`${baseUrl}/v1/freight/files/${fileId}`, { headers });
      const latestData = await json(latestRes);
      const currentVersion = latestData.data.version;

      const res = await fetch(`${baseUrl}/v1/freight/files/${fileId}/special-handling`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: currentVersion,
          special_handling: 'IMDG',
          reason: 'Awaiting shipper MSDS confirmation sheet',
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data.special_handling).toBe('IMDG');
      expect(data.data.special_status).toBe('RED');
    });
  });

  // ── 9. Explicit Lifecycle Action Endpoints ──────────────────────────────

  describe('9. Explicit Action Endpoints (Import & Export)', () => {
    let testImportId: string;
    let testExportId: string;

    it('Import: release-bl transitions Draft -> ReleasePending', async () => {
      // Create fresh import file
      const createRes = await fetch(`${baseUrl}/v1/freight/files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'sea',
          direction: 'import',
          vessel: 'Maersk Mc-Kinney Moller',
          voyage: '2602W',
        }),
      });
      const createData = await json(createRes);
      testImportId = createData.data.id;

      // Add released MBL to pass BL_RELEASE gate
      await fetch(`${baseUrl}/v1/freight/files/${testImportId}/bills-of-lading`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'MBL',
          bl_number: 'MSKU8822001',
          telex_release: true,
          released_at: new Date().toISOString(),
        }),
      });

      // Refetch file to get version
      const fRes = await fetch(`${baseUrl}/v1/freight/files/${testImportId}`, { headers });
      const fData = await json(fRes);

      const res = await fetch(`${baseUrl}/v1/freight/files/${testImportId}/release-bl`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: fData.data.version,
          reason: 'B/L released by carrier',
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data.file.status).toBe('ReleasePending');
    });

    it('Import: generic transitions require ATD and ATA', async () => {
      const fileRes = await fetch(`${baseUrl}/v1/freight/files/${testImportId}`, { headers });
      const fileData = await json(fileRes);
      for (const [target, code] of [['InTransit', 'ATD_REQUIRED'], ['Arrived', 'ATA_REQUIRED']]) {
        const res = await fetch(`${baseUrl}/v1/freight/files/${testImportId}/transition`, {
          method: 'POST', headers,
          body: JSON.stringify({ version: fileData.data.version, target_status: target }),
        });
        const data = await json(res);
        expect(res.status).toBe(422);
        expect(data.error.code).toBe(code);
      }
    });

    it('Import: record-ata defaults ATA to current time and transitions to Arrived', async () => {
      const fRes = await fetch(`${baseUrl}/v1/freight/files/${testImportId}`, { headers });
      const fData = await json(fRes);

      const res = await fetch(`${baseUrl}/v1/freight/files/${testImportId}/record-ata`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: fData.data.version,
          reason: 'Vessel berthed at ECT Delta',
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data.file.status).toBe('Arrived');
      expect(data.data.file.ata).toBeTruthy();
    });

    it('Import: deliver transitions Cleared -> Delivered', async () => {
      // Submit customs data to the bus, then receive the independent replies.
      const fRes = await fetch(`${baseUrl}/v1/freight/files/${testImportId}`, { headers });
      const fData = await json(fRes);

      const submitRes = await fetch(`${baseUrl}/v1/integrations/files/${testImportId}/customs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: fData.data.version }),
      });
      expect(submitRes.status).toBe(202);
      const submitData = await json(submitRes);
      for (const [event_type, payload] of [
        ['portbase.container.released', { file_id: testImportId, released_at: new Date().toISOString() }],
        ['declaration.accepted', { file_id: testImportId, declaration_id: submitData.data.declaration_id,
          mrn: '26NL12345678900001' }],
      ] as const) {
        const reply = await fetch(`${baseUrl}/v1/dev/simulate`, { method: 'POST', headers,
          body: JSON.stringify({ event_type, payload, direct_dispatch: true }) });
        expect(reply.status).toBe(200);
      }

      // Both replies arrived; gates now advance Arrived to Cleared.
      const fRes2 = await fetch(`${baseUrl}/v1/freight/files/${testImportId}`, { headers });
      const fData2 = await json(fRes2);
      expect(fData2.data.status).toBe('Cleared');

      // Deliver
      const deliverRes = await fetch(`${baseUrl}/v1/freight/files/${testImportId}/deliver`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: fData2.data.version,
          reason: 'Consignee signed POD',
        }),
      });
      const deliverData = await json(deliverRes);
      expect(deliverRes.status).toBe(200);
      expect(deliverData.data.file.status).toBe('Delivered');

      // Close
      const closeRes = await fetch(`${baseUrl}/v1/freight/files/${testImportId}/close`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: deliverData.data.file.version,
          reason: 'Job completed & handed to invoicing',
        }),
      });
      const closeData = await json(closeRes);
      expect(closeRes.status).toBe(200);
      expect(closeData.data.file.status).toBe('Closed');
    });

    it('Export: book -> submit-vgm -> load -> issue-bl -> close lifecycle', async () => {
      // 1. Create Export file
      const createRes = await fetch(`${baseUrl}/v1/freight/files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'sea',
          direction: 'export',
          vessel: 'CMA CGM Jacques Saade',
          voyage: '2603E',
          vgm_cutoff: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }),
      });
      const createData = await json(createRes);
      testExportId = createData.data.id;

      // 2. Book
      const bookRes = await fetch(`${baseUrl}/v1/freight/files/${testExportId}/book`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: createData.data.version,
          reason: 'Space confirmed on vessel',
        }),
      });
      const bookData = await json(bookRes);
      expect(bookRes.status).toBe(200);
      expect(bookData.data.file.status).toBe('Booked');

      const missingVgmRes = await fetch(`${baseUrl}/v1/freight/files/${testExportId}/submit-vgm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: bookData.data.file.version }),
      });
      const missingVgmData = await json(missingVgmRes);
      expect(missingVgmRes.status).toBe(422);
      expect(missingVgmData.error.code).toBe('VGM_CUTOFF_GATE_FAILED');

      // 3. Add a container with VGM submitted before the cut-off
      await fetch(`${baseUrl}/v1/freight/files/${testExportId}/containers`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          container_number: 'CMAU1234567',
          type: '40HC',
          tare_weight_kg: 3800,
          gross_weight_kg: 24000,
          vgm_kg: 24000,
          vgm_submitted_at: new Date().toISOString(),
        }),
      });

      const beforeVgmRes = await fetch(`${baseUrl}/v1/freight/files/${testExportId}`, { headers });
      const beforeVgmData = await json(beforeVgmRes);

      const prematureLoadRes = await fetch(`${baseUrl}/v1/freight/files/${testExportId}/load`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version: beforeVgmData.data.version }),
      });
      const prematureLoadData = await json(prematureLoadRes);
      expect(prematureLoadRes.status).toBe(400);
      expect(prematureLoadData.error.code).toBe('INVALID_TRANSITION');

      // 4. Submit VGM
      const vgmRes = await fetch(`${baseUrl}/v1/freight/files/${testExportId}/submit-vgm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: beforeVgmData.data.version,
          reason: 'Shipper confirmed certified weights',
        }),
      });
      const vgmData = await json(vgmRes);
      expect(vgmRes.status).toBe(200);
      expect(vgmData.data.file.status).toBe('VgmSiSubmitted');

      const fRes = await fetch(`${baseUrl}/v1/freight/files/${testExportId}`, { headers });
      const fData = await json(fRes);

      // 5. Load
      const loadRes = await fetch(`${baseUrl}/v1/freight/files/${testExportId}/load`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: fData.data.version,
          reason: 'Loaded on board',
        }),
      });
      const loadData = await json(loadRes);
      expect(loadRes.status).toBe(200);
      expect(loadData.data.file.status).toBe('Loaded');

      // 6. Issue BL
      const issueRes = await fetch(`${baseUrl}/v1/freight/files/${testExportId}/issue-bl`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: loadData.data.file.version,
          reason: 'Original B/L dispatched',
        }),
      });
      const issueData = await json(issueRes);
      expect(issueRes.status).toBe(200);
      expect(issueData.data.file.status).toBe('BlIssued');

      // 7. Close
      const closeRes = await fetch(`${baseUrl}/v1/freight/files/${testExportId}/close`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          version: issueData.data.file.version,
          reason: 'Export complete',
        }),
      });
      const closeData = await json(closeRes);
      expect(closeRes.status).toBe(200);
      expect(closeData.data.file.status).toBe('Closed');
    });
  });
});
