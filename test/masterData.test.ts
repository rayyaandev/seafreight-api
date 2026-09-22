import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import type { Server } from 'http';

const json = (res: Response): Promise<any> => res.json();

const PORT = 4899;
const baseUrl = `http://localhost:${PORT}`;

let server: Server;
let token: string;
let headers: Record<string, string>;

beforeAll(async () => {
  const app = createApp();
  server = app.listen(PORT);

  // Login as Coordinator (has masterdata.read permission)
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

describe('Master Data Typeahead API', () => {
  it('GET /v1/masterdata/locations returns ports list', async () => {
    const res = await fetch(`${baseUrl}/v1/masterdata/locations`, { headers });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/masterdata/locations?q=Rotterdam finds Rotterdam port', async () => {
    const res = await fetch(`${baseUrl}/v1/masterdata/locations?q=Rotterdam`, { headers });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const found = body.data.find((l: any) => l.name.includes('Rotterdam') || l.un_locode === 'NLRTM');
    expect(found).toBeDefined();
    expect(found.un_locode).toBe('NLRTM');
  });

  it('GET /v1/masterdata/carriers?q=Maersk finds carrier', async () => {
    const res = await fetch(`${baseUrl}/v1/masterdata/carriers?q=Maersk`, { headers });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const found = body.data.find((c: any) => c.name.toLowerCase().includes('maersk'));
    expect(found).toBeDefined();
  });

  it('GET /v1/masterdata/clients returns seeded clients', async () => {
    const res = await fetch(`${baseUrl}/v1/masterdata/clients`, { headers });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/masterdata/incoterms returns incoterms', async () => {
    const res = await fetch(`${baseUrl}/v1/masterdata/incoterms`, { headers });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/masterdata/currencies returns currencies', async () => {
    const res = await fetch(`${baseUrl}/v1/masterdata/currencies`, { headers });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const eur = body.data.find((c: any) => c.code === 'EUR');
    expect(eur).toBeDefined();
  });

  it('GET /v1/masterdata/unknown_entity returns 400 with INVALID_ENTITY', async () => {
    const res = await fetch(`${baseUrl}/v1/masterdata/unknown_entity`, { headers });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe('INVALID_ENTITY');
  });

  it('GET /v1/masterdata/locations without auth token returns 401', async () => {
    const res = await fetch(`${baseUrl}/v1/masterdata/locations`);
    expect(res.status).toBe(401);
  });
});
