import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { seedDatabase } from '../src/db/seeds/01_sea_freight_seed.js';
import type { Server } from 'http';
import { testPorts } from './helpers/ports.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

const PORT = 4999;
const baseUrl = `http://localhost:${PORT}`;

let server: Server;
let headers: Record<string, string>;

beforeAll(async () => {
  await seedDatabase();
  const app = createApp();
  server = app.listen(PORT);

  // Login as Coordinator to get auth token
  const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'coordinator@yourcargocontact.com',
      password: 'Password123!',
    }),
  });
  const loginData = await json(loginRes);
  headers = {
    Authorization: `Bearer ${loginData.data.access_token}`,
    'Content-Type': 'application/json',
  };
});

afterAll(() => {
  server.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Sea Freight API Integration', () => {
  // ── 1. Health Check ─────────────────────────────────────────────────────

  it('Health check returns 200 with database connected', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = await json(res);
    expect(res.status).toBe(200);
    expect(data.data.database).toBe('connected');
  });

  // ── 2. Metrics ──────────────────────────────────────────────────────────

  it('GET /v1/freight/metrics returns at least 4 active sea files', async () => {
    const res = await fetch(`${baseUrl}/v1/freight/metrics`, { headers });
    const data = await json(res);
    expect(res.status).toBe(200);
    expect(Number(data.data.total_active)).toBeGreaterThanOrEqual(4);
  });

  // ── 3. List Freight Files ───────────────────────────────────────────────

  describe('List & Dossier', () => {
    let exportFile: any;
    let importFile: any;
    let listData: any;

    beforeAll(async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files?mode=sea`, { headers });
      listData = await json(res);
      exportFile = listData.data.find((f: any) => f.file_no === 'SF-2026-00004');
      importFile = listData.data.find((f: any) => f.file_no === 'SF-2026-00001');
    });

    it('GET /v1/freight/files returns 200 with files array', () => {
      expect(listData.data).toBeInstanceOf(Array);
    });

    it('Pagination total reflects seeded count', () => {
      expect(listData.page.total).toBeGreaterThanOrEqual(4);
    });

    it('Found seeded file SF-2026-00004', () => {
      expect(exportFile).toBeTruthy();
    });

    // ── 4. Dossier ──────────────────────────────────────────────────────

    it('GET /v1/freight/files/:id dossier includes containers and reefer compliance', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${exportFile.id}`, { headers });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data.containers.length).toBeGreaterThan(0);
      expect(data.data.special_handling_evaluation.status.toLowerCase()).toBe('green');
    });

    // ── 5. State Machine: Illegal Transition ────────────────────────────

    it('Illegal state transition rejected with 400 INVALID_TRANSITION', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${exportFile.id}/transition`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          target_status: 'delivered',
          version: exportFile.version,
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(400);
      expect(data.error.code).toBe('INVALID_TRANSITION');
    });

    // ── 6. Valid Transition ─────────────────────────────────────────────

    it('Valid state transition to loaded succeeds', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${exportFile.id}/transition`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          target_status: 'loaded',
          version: exportFile.version,
          reason: 'All containers gated in and loaded on Al Jmeliyah',
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(200);
      expect(data.data.file.status.toLowerCase()).toBe('loaded');
    });

    // ── 7. Gate Violation ───────────────────────────────────────────────

    it('Import file requires ATA before transition to arrived', async () => {
      const blocked = await fetch(`${baseUrl}/v1/freight/files/${importFile.id}/transition`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          target_status: 'arrived',
          version: importFile.version,
        }),
      });
      const blockedData = await json(blocked);
      expect(blocked.status).toBe(422);
      expect(blockedData.error.code).toBe('ATA_REQUIRED');

      const patchRes = await fetch(`${baseUrl}/v1/freight/files/${importFile.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ version: importFile.version, ata: new Date().toISOString() }),
      });
      const patched = await json(patchRes);
      expect(patchRes.status).toBe(200);

      const res = await fetch(`${baseUrl}/v1/freight/files/${importFile.id}/transition`, {
        method: 'POST', headers,
        body: JSON.stringify({ target_status: 'arrived', version: patched.data.version }),
      });
      expect(res.status).toBe(200);
    });

    it('Un-cleared customs declaration gate blocks transition with 422', async () => {
      // Re-fetch the file to get the updated version after arrived transition
      const fileRes = await fetch(`${baseUrl}/v1/freight/files/${importFile.id}`, { headers });
      const fileData = await json(fileRes);

      const res = await fetch(`${baseUrl}/v1/freight/files/${importFile.id}/transition`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          target_status: 'cleared',
          version: fileData.data.version,
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(422);
      expect(data.error.code).toBe('CUSTOMS_RELEASE_GATE_FAILED');
    });
  });

  // ── 8. Create File with Auto human_id ─────────────────────────────────

  describe('File Creation & Drayage', () => {
    let createdFileId: string;

    it('POST /v1/freight/files creates file with auto-generated human_id', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'sea',
          direction: 'import',
          ...await testPorts(),
          shipper_name: 'Kyoto Electronics Co.',
          consignee_name: 'Dutch Distribution Center B.V.',
          pol: 'JPOSA',
          pod: 'NLRTM',
          carrier_name: 'ONE (Ocean Network Express)',
          special_handling_type: 'none',
          currency: 'EUR',
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(201);
      expect(data.data.file_no || data.data.human_id).toMatch(/^SF-/);

      createdFileId = data.data.id;
    });

    // ── 9. Drayage Transport Order ──────────────────────────────────────

    it('POST /v1/freight/files/:id/drayage creates transport order', async () => {
      const res = await fetch(`${baseUrl}/v1/freight/files/${createdFileId}/drayage`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'import_delivery',
          terminal_name: 'ECT Delta Terminal',
          facility_address: 'Europaweg 875, 3199 LD Rotterdam',
          trucking_company: 'Mainport Trucking B.V.',
        }),
      });
      const data = await json(res);
      expect(res.status).toBe(201);
      expect(data.data.order_number).toMatch(/^TR-/);
    });
  });
});
