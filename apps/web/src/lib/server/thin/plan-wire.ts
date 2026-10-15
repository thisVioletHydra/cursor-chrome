// Process-wide planner link used by /api/ext/next (flag in plan-flags.sqlite, default off).
import { createPlanFlags } from './plan-flags.ts';
import { createPlanLink } from './plan-link.ts';
import { planDeps } from './plan-deps.ts';

export const planFlags = createPlanFlags();
export const planLink = createPlanLink({ primitiveOnly: true, flags: planFlags, deps: headersOf => planDeps(headersOf, planFlags) });
