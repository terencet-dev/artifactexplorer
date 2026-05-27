import { test, expect } from '@playwright/test';

test.describe('API Health', () => {
  const BASE = '';  // resolved at runtime from baseURL

  test('sbom-index enabled endpoint returns JSON', async ({ request }) => {
    const res = await request.get('/api/sbom-index/enabled');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('enabled');
  });

  test('sbom-index meta returns status', async ({ request }) => {
    const res = await request.get('/api/sbom-index/meta?registry=mcr.microsoft.com');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(['indexing', 'complete', 'disabled']).toContain(body.status);
  });

  test('sbom-index search returns results for "openssl"', async ({ request }) => {
    const res = await request.get('/api/sbom-index/search?q=openssl&registryId=mcr-microsoft-com&limit=3', {
      timeout: 60000,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('results');
    expect(body.total).toBeGreaterThan(0);
  });

  test('sbom-index search returns results for "debian"', async ({ request }) => {
    const res = await request.get('/api/sbom-index/search?q=debian&registryId=mcr-microsoft-com&limit=3', {
      timeout: 60000,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.results.length).toBeGreaterThan(0);
  });

  test('sbom-index search returns results for "ubuntu"', async ({ request }) => {
    const res = await request.get('/api/sbom-index/search?q=ubuntu&registryId=mcr-microsoft-com&limit=3', {
      timeout: 60000,
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.total).toBeGreaterThan(0);
  });

  test('eol stats endpoint returns counts', async ({ request }) => {
    const res = await request.get('/api/sbom-index/eol?mode=stats&registryId=mcr-microsoft-com');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('expired');
    expect(body.total).toBeGreaterThan(0);
  });

  test('eol search endpoint returns results', async ({ request }) => {
    const res = await request.get('/api/sbom-index/eol?mode=search&registryId=mcr-microsoft-com&limit=3');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('results');
    expect(body.results.length).toBeGreaterThan(0);
  });

  test('crawl route responds', async ({ request }) => {
    const res = await request.get('/api/sbom-index/crawl');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('provider');
  });

  test('changelog endpoint returns text', async ({ request }) => {
    const res = await request.get('/api/changelog');
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain('Changelog');
  });

  test('homepage returns 200', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
  });
});
