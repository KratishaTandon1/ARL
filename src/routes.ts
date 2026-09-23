import { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from './db';
import { z } from 'zod';
import { 
  createTraySchema, 
  seedBatchSchema, 
  advanceStageSchema, 
  recordHarvestSchema,
  batchFilterSchema,
  yieldReportSchema
} from './types';
import { dashboardHtml } from './dashboard';

const STAGES = ['SEEDED', 'GERMINATION', 'GROWING', 'HARVEST_READY', 'HARVESTED'];

export async function setupRoutes(fastify: FastifyInstance) {
  // --- DASHBOARD ---
  fastify.get('/', async (req, reply) => {
    reply.type('text/html').send(dashboardHtml);
  });

  // --- TRAYS ---
  
  fastify.post('/trays', async (req, reply) => {
    try {
      const body = createTraySchema.parse(req.body);
      const res = await db.query(
        'INSERT INTO trays (code, zone, capacity_units) VALUES ($1, $2, $3) RETURNING *',
        [body.code, body.zone, body.capacity_units]
      );
      return reply.status(201).send(res.rows[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Bad Request', details: error.issues });
      }
      if ((error as any).code === '23505') { // Unique violation
        return reply.status(409).send({ error: 'Conflict', message: 'Tray code already exists' });
      }
      throw error;
    }
  });

  fastify.get('/trays', async (req, reply) => {
    const res = await db.query('SELECT * FROM trays ORDER BY created_at DESC');
    return res.rows;
  });

  fastify.get('/trays/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = req.params;
    try {
      const res = await db.query('SELECT * FROM trays WHERE id = $1', [id]);
      if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Not Found' });
      }
      return res.rows[0];
    } catch (error) {
        if ((error as any).code === '22P02') {
          return reply.status(404).send({ error: 'Not Found' });
        }
        throw error;
    }
  });

  // --- BATCHES ---
  
  fastify.post('/batches', async (req, reply) => {
    try {
      const body = seedBatchSchema.parse(req.body);
      
      // Check if tray exists
      const trayRes = await db.query('SELECT id FROM trays WHERE id = $1', [body.tray_id]);
      if (trayRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Tray not found' });
      }

      // Try inserting the batch. The unique partial index on tray_id where stage != 'HARVESTED'
      // will throw a unique violation (23505) if the tray already has an active batch.
      const res = await db.query(
        "INSERT INTO batches (tray_id, crop, expected_harvest_on, stage) VALUES ($1, $2, $3, 'SEEDED') RETURNING *",
        [body.tray_id, body.crop, body.expected_harvest_on || null]
      );
      
      return reply.status(201).send(res.rows[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Bad Request', details: error.issues });
      }
      if ((error as any).code === '23505') { // Unique constraint violation
        return reply.status(409).send({ error: 'Conflict', message: 'Tray already has an active batch' });
      }
      if ((error as any).code === '22P02') { // invalid input syntax for type uuid
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid UUID format' });
      }
      throw error;
    }
  });

  fastify.patch('/batches/:id/stage', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const { id } = req.params;
      const body = advanceStageSchema.parse(req.body);
      
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        
        // Select for update to prevent concurrent stage modifications on the same batch
        const batchRes = await client.query('SELECT stage FROM batches WHERE id = $1 FOR UPDATE', [id]);
        if (batchRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Batch not found' });
        }
        
        const currentStage = batchRes.rows[0].stage;
        const currentIndex = STAGES.indexOf(currentStage);
        const targetIndex = STAGES.indexOf(body.stage);
        
        // Rules: Can only move forward, and only ONE step at a time.
        if (targetIndex !== currentIndex + 1) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ 
            error: 'Bad Request', 
            message: `Invalid stage transition from ${currentStage} to ${body.stage}. Can only advance one step forward.` 
          });
        }
        
        const updateRes = await client.query(
          'UPDATE batches SET stage = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
          [body.stage, id]
        );
        
        await client.query('COMMIT');
        return updateRes.rows[0];
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Bad Request', details: error.issues });
      }
      if ((error as any).code === '22P02') { // invalid input syntax for type uuid
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid UUID format' });
      }
      throw error;
    }
  });

  fastify.post('/batches/:id/harvest', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const { id } = req.params;
      const body = recordHarvestSchema.parse(req.body);
      
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        
        const batchRes = await client.query('SELECT stage FROM batches WHERE id = $1 FOR UPDATE', [id]);
        if (batchRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Batch not found' });
        }
        
        const batch = batchRes.rows[0];
        
        // Rule: harvest can only be recorded for a batch in HARVEST_READY
        if (batch.stage !== 'HARVEST_READY') {
          await client.query('ROLLBACK');
          return reply.status(400).send({ 
            error: 'Bad Request', 
            message: `Cannot harvest batch in stage ${batch.stage}. Must be HARVEST_READY.` 
          });
        }
        
        // Update batch to HARVESTED
        await client.query(
          "UPDATE batches SET stage = 'HARVESTED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
          [id]
        );
        
        // Insert harvest record
        const harvestRes = await client.query(
          'INSERT INTO harvests (batch_id, weight_grams, grade) VALUES ($1, $2, $3) RETURNING *',
          [id, body.weight_grams, body.grade]
        );
        
        await client.query('COMMIT');
        return reply.status(201).send(harvestRes.rows[0]);
        
      } catch (e) {
        await client.query('ROLLBACK');
        if ((e as any).code === '23505') { 
             return reply.status(409).send({ error: 'Conflict', message: 'Harvest already recorded for this batch' });
        }
        throw e;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Bad Request', details: error.issues });
      }
      if ((error as any).code === '22P02') { // invalid input syntax for type uuid
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid UUID format' });
      }
      throw error;
    }
  });

  fastify.get('/batches', async (req, reply) => {
    try {
      const query = batchFilterSchema.parse(req.query);
      
      let sql = 'SELECT batches.*, trays.zone FROM batches JOIN trays ON batches.tray_id = trays.id WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;
      
      if (query.stage) {
        sql += ` AND stage = $${paramIndex++}`;
        params.push(query.stage);
      }
      
      if (query.crop) {
        sql += ` AND crop = $${paramIndex++}`;
        params.push(query.crop);
      }
      
      if (query.zone) {
        sql += ` AND trays.zone = $${paramIndex++}`;
        params.push(query.zone);
      }
      
      sql += ` ORDER BY seeded_on DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(query.limit);
      params.push((query.page - 1) * query.limit);
      
      const res = await db.query(sql, params);
      return res.rows;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Bad Request', details: error.issues });
      }
      throw error;
    }
  });

  // --- REPORTS ---
  fastify.get('/reports/yield', async (req, reply) => {
    try {
      const query = yieldReportSchema.parse(req.query);
      
      const sql = `
        SELECT 
          CASE WHEN $1::text = 'crop' THEN b.crop ELSE t.zone END AS group_name,
          SUM(h.weight_grams)::int AS total_weight_grams,
          COUNT(h.id)::int AS batches_harvested,
          AVG(EXTRACT(EPOCH FROM (h.harvested_on - b.seeded_on)) / 86400)::float AS avg_days_to_harvest
        FROM harvests h
        JOIN batches b ON h.batch_id = b.id
        JOIN trays t ON b.tray_id = t.id
        WHERE h.harvested_on >= $2 AND h.harvested_on <= $3
        GROUP BY 1
        ORDER BY 1
      `;
      
      const res = await db.query(sql, [query.group_by, query.from, query.to]);
      return res.rows;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Bad Request', details: error.issues });
      }
      throw error;
    }
  });
}
