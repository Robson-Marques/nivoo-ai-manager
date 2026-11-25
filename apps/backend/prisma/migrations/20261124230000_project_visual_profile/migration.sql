-- Additive: existing projects keep their visual identity unchanged.
ALTER TABLE "Project"
  ADD COLUMN "visualProfile" JSONB,
  ADD COLUMN "visualProfileRevision" INTEGER NOT NULL DEFAULT 0;
