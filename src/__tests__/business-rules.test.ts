import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../index';
import { db } from '../db';
import { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildServer();
  await app.ready();
  // Clear the database tables for clean test state
  await db.query('DELETE FROM harvests');
  await db.query('DELETE FROM batches');
  await db.query('DELETE FROM trays');
});

afterAll(async () => {
  await app.close();
  await db.end();
});

describe('Business Rules', () => {
  let trayId: string;
  let batchId: string;

  it('Setup: Create a tray', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-A-TEST', zone: 'A', capacity_units: 10 }
    });
    expect(res.statusCode).toBe(201);
    trayId = res.json().id;
  });

  it('Rule 1: A tray can hold at most one active batch', async () => {
    // Seed first batch
    const res1 = await app.inject({
      method: 'POST',
      url: '/batches',
      payload: { tray_id: trayId, crop: 'Lettuce' }
    });
    expect(res1.statusCode).toBe(201);
    batchId = res1.json().id;

    // Attempt to seed second active batch in the same tray
    const res2 = await app.inject({
      method: 'POST',
      url: '/batches',
      payload: { tray_id: trayId, crop: 'Basil' }
    });
    expect(res2.statusCode).toBe(409); // Conflict due to unique constraint
  });

  it('Rule 2: Stage transitions only move forward, and only one step at a time', async () => {
    // Current stage is SEEDED
    // Try skipping GERMINATION to GROWING
    const resSkip = await app.inject({
      method: 'PATCH',
      url: `/batches/${batchId}/stage`,
      payload: { stage: 'GROWING' }
    });
    expect(resSkip.statusCode).toBe(400);

    // Try going backward (though it's seeded, let's advance first)
    const resForward = await app.inject({
      method: 'PATCH',
      url: `/batches/${batchId}/stage`,
      payload: { stage: 'GERMINATION' }
    });
    expect(resForward.statusCode).toBe(200);

    // Try going backward to SEEDED
    const resBackward = await app.inject({
      method: 'PATCH',
      url: `/batches/${batchId}/stage`,
      payload: { stage: 'SEEDED' }
    });
    expect(resBackward.statusCode).toBe(400);

    // Advance to HARVEST_READY
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage`, payload: { stage: 'GROWING' } });
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage`, payload: { stage: 'HARVEST_READY' } });
  });

  it('Rule 3: A harvest can only be recorded for a batch in HARVEST_READY', async () => {
    // Seed a new batch in a new tray to test failure case
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-A-TEST-2', zone: 'A', capacity_units: 10 }
    });
    const newTrayId = trayRes.json().id;

    const batchRes = await app.inject({
      method: 'POST',
      url: '/batches',
      payload: { tray_id: newTrayId, crop: 'Kale' }
    });
    const newBatchId = batchRes.json().id;

    // Try harvesting a SEEDED batch
    const failHarvest = await app.inject({
      method: 'POST',
      url: `/batches/${newBatchId}/harvest`,
      payload: { weight_grams: 500, grade: 'A' }
    });
    expect(failHarvest.statusCode).toBe(400);
  });

  it('Rule 4: Recording a harvest moves the batch to HARVESTED and frees the tray for reuse', async () => {
    // Harvest the HARVEST_READY batch from Rule 2
    const harvestRes = await app.inject({
      method: 'POST',
      url: `/batches/${batchId}/harvest`,
      payload: { weight_grams: 1000, grade: 'A' }
    });
    expect(harvestRes.statusCode).toBe(201);

    // Verify batch stage is HARVESTED
    const verifyBatchRes = await db.query('SELECT stage FROM batches WHERE id = $1', [batchId]);
    expect(verifyBatchRes.rows[0].stage).toBe('HARVESTED');

    // Freeing the tray: We should now be able to seed a new batch into the original tray
    const newSeedRes = await app.inject({
      method: 'POST',
      url: '/batches',
      payload: { tray_id: trayId, crop: 'Spinach' }
    });
    expect(newSeedRes.statusCode).toBe(201); // Success, tray is free!
  });

  it('Part 3a: Concurrency Safety', async () => {
    // Create a new tray
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-A-CONCURRENCY', zone: 'A', capacity_units: 10 }
    });
    const testTrayId = trayRes.json().id;

    // Fire 5 concurrent requests to seed a batch in the same tray
    const promises = Array(5).fill(0).map(() => 
      app.inject({
        method: 'POST',
        url: '/batches',
        payload: { tray_id: testTrayId, crop: 'Mint' }
      })
    );

    const results = await Promise.all(promises);
    
    // Exactly ONE should succeed (201), the rest should fail cleanly with 409
    const successes = results.filter(r => r.statusCode === 201);
    const conflicts = results.filter(r => r.statusCode === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(4);
  });
});
