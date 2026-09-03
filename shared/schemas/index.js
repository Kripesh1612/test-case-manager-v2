// Barrel re-export so server routes can keep their old import style:
//   const { loginSchema } = require('../shared/schemas');
// instead of having to know which file each schema lives in.
//
// Client code should prefer the per-resource file directly so Vite's
// esbuild step can tree-shake unused schemas from the bundle.

export {
  testCaseSchema,
  testCaseUpdateSchema,
  STATUS_VALUES,
  PRIORITY_VALUES,
  RESULT_VALUES,
} from './testCase.js';

export { testSuiteSchema, testSuiteUpdateSchema } from './testSuite.js';

export {
  caseSnapshotSchema,
  caseVersionSummarySchema,
  caseVersionDetailSchema,
  diffFieldSchema,
  diffResponseSchema,
} from './caseVersion.js';

export {
  flakinessReportSchema,
  flakinessSummarySchema,
  flakyListSchema,
  FLAKINESS_VERDICTS,
} from './flakiness.js';

export {
  registerSchema,
  loginSchema,
  updateUserRoleSchema,
  ROLE_VALUES,
} from './auth.js';

export { scheduledJobSchema, scheduledJobUpdateSchema } from './scheduledJob.js';