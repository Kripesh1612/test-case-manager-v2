-- Feature 4: projects.description (nullable text) for the projects admin page.
-- Added separately so the dockerised Prisma client (regenerated at image
-- build from schema.prisma) always matches the applied migrations.

ALTER TABLE "projects" ADD COLUMN "description" TEXT;