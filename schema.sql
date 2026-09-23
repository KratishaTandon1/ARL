CREATE TABLE IF NOT EXISTS trays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    zone VARCHAR(50) NOT NULL,
    capacity_units INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tray_id UUID NOT NULL REFERENCES trays(id),
    crop VARCHAR(100) NOT NULL,
    seeded_on TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    stage VARCHAR(20) NOT NULL DEFAULT 'SEEDED' CHECK (stage IN ('SEEDED', 'GERMINATION', 'GROWING', 'HARVEST_READY', 'HARVESTED')),
    expected_harvest_on TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Part 3a: Concurrency Safety
-- This ensures a tray can only have ONE active batch at any time.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_batch_per_tray 
ON batches(tray_id) 
WHERE stage != 'HARVESTED';

CREATE TABLE IF NOT EXISTS harvests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES batches(id) UNIQUE,
    harvested_on TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    weight_grams INT NOT NULL,
    grade VARCHAR(1) NOT NULL CHECK (grade IN ('A', 'B', 'C'))
);
