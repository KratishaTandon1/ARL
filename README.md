# ARL Intern Assignment: Leafy Greens API

This is a REST API built for tracking batches of leafy greens in aeroponic trays, satisfying Parts 1, 2, and 3a of the assignment.

## Setup Instructions

1. **Prerequisites:** 
   - Node.js (v18+)
   - PostgreSQL (or Docker/Docker Compose to run it)

2. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd arl-assignment
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Database Setup:**
   If you have Docker Compose, you can easily spin up the database:
   ```bash
   docker compose up -d
   ```
   *Note: This will automatically run `schema.sql` on startup.*
   
   Copy the example environment variables file (contains default local credentials):
   ```bash
   cp .env.example .env
   ```
   
   If you are running PostgreSQL locally without Docker, simply create a database (e.g., `arl_db`) and execute `schema.sql` against it. Ensure you set the `DATABASE_URL` environment variable if your credentials differ from the default:
   ```bash
   export DATABASE_URL="postgres://postgres:password@localhost:5432/arl_db"
   ```

5. **Start the API:**
   ```bash
   npm run dev
   ```
   The server will start on port `3000`.

6. **Run Tests:**
   The integration tests require the database to be running.
   ```bash
   npm run test
   ```

## Assumptions & Decisions

- **Framework Choice:** Used Fastify (as requested) along with TypeScript and `zod` for rigorous request validation. `zod` ensures that any invalid bodies (like missing fields or invalid stage enums) are rejected immediately with a `400 Bad Request`.
- **Database Driver:** Used the standard `pg` client instead of an ORM (like Prisma or TypeORM). The assignment requested SQL for schema design, and raw SQL makes it crystal clear where the logic and constraints are applied.
- **Rule Enforcement Strategy:**
  - **Rule 1 (Active batch per tray):** Enforced strictly at the **Database level** using a partial unique index (`CREATE UNIQUE INDEX ON batches(tray_id) WHERE stage != 'HARVESTED'`). This guarantees data integrity even with race conditions.
  - **Rule 2 & 3 (Stage transitions and Harvests):** Enforced in the **Handler (Application level)** within PostgreSQL Transactions. The handler reads the current state `FOR UPDATE`, validates the business rules, and updates the database, ensuring atomicity.
  - **Rule 4 (Frees tray for reuse):** Handled organically. Updating a batch to `HARVESTED` drops it out of the partial unique index, automatically freeing the tray for a new active batch.
- **PATCH Stage Advancing:** The prompt states "advances a batch by one stage". I designed the API to be idempotent by requiring the target stage in the request body (e.g., `{ "stage": "GROWING" }`), and the handler validates that this target stage is exactly one step forward from the current stage.
- **UUID vs Serial:** Used `UUID`s for IDs instead of auto-incrementing integers for security (unguessable IDs) and easier distributed ID generation.
- **Pagination Defaults:** For `GET /batches`, pagination defaults to `page=1` and `limit=20` if not provided.

## Part 3 Attempt: 3a Concurrency Safety

I tackled **Part 3a**. The problem states: *Two requests arrive at the same instant, both trying to seed a batch into tray T-A-014. Exactly one must succeed. The other must fail cleanly.*

**How it works:**
In `schema.sql`, I added a partial unique index on the `batches` table:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_batch_per_tray 
ON batches(tray_id) 
WHERE stage != 'HARVESTED';
```
When two concurrent requests attempt to `INSERT` a new active batch for the same `tray_id`, PostgreSQL's internal concurrency control processes the inserts. The first one succeeds. The second one fails instantaneously at the database level with a `23505` (Unique Constraint Violation) error. 

The Fastify handler catches this specific `23505` error and cleanly maps it to a `409 Conflict` HTTP status code:
```typescript
if ((error as any).code === '23505') {
  return reply.status(409).send({ error: 'Conflict', message: 'Tray already has an active batch' });
}
```

**Why this approach holds behind a Load Balancer:**
This approach relies on the database—the single source of truth—to enforce the lock. Even if you run 50 instances of the API behind a load balancer, they all talk to the same database. The database guarantees that only one transaction can successfully commit the insert, preventing race conditions entirely without requiring complex application-level distributed locks (like Redis Mutexes).

I wrote a specific test for this in `src/__tests__/business-rules.test.ts` that fires 5 concurrent requests using `Promise.all()`. The test proves exactly one receives a `201 Created` and four receive a `409 Conflict`.

## Part 3 Attempt: 3c Yield Reporting

I also implemented **Part 3c (Yield reporting)**. 
The endpoint `GET /reports/yield?from=<date>&to=<date>&group_by=<crop|zone>` calculates the total harvested weight, number of batches harvested, and the average number of days from seeding to harvesting in a **single SQL query**:

```sql
SELECT 
  CASE WHEN $1 = 'crop' THEN b.crop ELSE t.zone END AS group_name,
  SUM(h.weight_grams)::int AS total_weight_grams,
  COUNT(h.id)::int AS batches_harvested,
  AVG(EXTRACT(EPOCH FROM (h.harvested_on - b.seeded_on)) / 86400)::float AS avg_days_to_harvest
FROM harvests h
JOIN batches b ON h.batch_id = b.id
JOIN trays t ON b.tray_id = t.id
WHERE h.harvested_on >= $2 AND h.harvested_on <= $3
GROUP BY 
  CASE WHEN $1 = 'crop' THEN b.crop ELSE t.zone END
ORDER BY group_name
```
This efficiently delegates the aggregation and mathematical calculations entirely to PostgreSQL.

## Testing & Environments
- **Environment Isolation:** The `docker-compose.yml` spins up two isolated databases: `db` (port 5432) for local dev and `db-test` (port 5433) for automated tests. The `vitest` runner naturally picks up the `.env.test` file to target the test database, ensuring your development data is never wiped during testing.
- **Dockerizing:** I added a `Dockerfile` for the Node.js API so it can be easily deployed via containers to production.

## AI Usage

I used an AI coding assistant (Gemini 3.1 Pro via Antigravity) to generate the boilerplate for Fastify, TypeScript setup, and Vitest test scaffolding. The architectural decisions, business logic, and database constraints were designed specifically to address the assignment requirements.
