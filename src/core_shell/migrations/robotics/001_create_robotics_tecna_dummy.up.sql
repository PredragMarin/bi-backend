CREATE SCHEMA IF NOT EXISTS robotics;

CREATE TABLE IF NOT EXISTS robotics.robot_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  robot_code TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  external_product_ref TEXT NOT NULL,
  request_payload JSONB NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS robotics.robot_results (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES robotics.robot_jobs(id) ON DELETE CASCADE,
  result_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  result_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id)
);
