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
      expect(data.data.special_status).toBe('ORANGE');

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
          humidity_percent: 85,
          pre_trip_inspection_passed: true,
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
    it('POST /v1/freight/files/:id/special-handling updates override status', async () => {
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
          special_status: 'ORANGE',
          reason: 'Awaiting shipper MSDS confirmation sheet',
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data.special_handling).toBe('IMDG');
      expect(data.data.special_status).toBe('ORANGE');
    });
  });
});
