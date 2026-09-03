const { PrismaClient } = require('@prisma/client');

// Single shared Prisma client instance for the whole app.
// Requiring this module from multiple files always returns the same client.
const prisma = new PrismaClient();

module.exports = prisma;
