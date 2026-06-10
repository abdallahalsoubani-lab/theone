-- PlanStatus enum extensions must commit before any object uses the new
-- labels (PostgreSQL 55P04). This migration runs alone so the follow-up
-- migration 20260519100000_clinical_workflows can reference 'PROPOSED' in
-- a partial unique index safely.

ALTER TYPE "PlanStatus" ADD VALUE IF NOT EXISTS 'PROPOSED';
ALTER TYPE "PlanStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "PlanStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
