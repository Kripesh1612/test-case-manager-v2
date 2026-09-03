const prisma = require('../db');

// Serialize a test case row from DB.
// On Postgres the `steps` and `tags` columns are JSONB, so Prisma returns
// them as native JS arrays. The `?? []` guards against null (which only
// happens for legacy rows or in tests that bypass the schema).
const serializeTestCase = (tc) => ({
  ...tc,
  steps: tc.steps ?? [],
  tags: tc.tags ?? [],
});

// Serialize a suite — joins are stored in the test_suite_cases table,
// so we read them separately and surface them as a `test_case_ids` array
const serializeSuite = async (suite) => {
  const links = await prisma.testSuiteCase.findMany({
    where: { test_suite_id: suite.id },
    select: { test_case_id: true },
  });
  return {
    ...suite,
    test_case_ids: links.map((l) => l.test_case_id),
  };
};

module.exports = { serializeTestCase, serializeSuite };
