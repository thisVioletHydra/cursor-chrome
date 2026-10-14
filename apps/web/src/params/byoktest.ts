import type { ParamMatcher } from '@sveltejs/kit';

// POST /api/byok/test lives in [action=byoktest]: a folder literally named "test" is picked up by node --test.
export const match: ParamMatcher = param => param === 'test';
