import type { Scenario } from '../plan/types.ts';
import { accountJson, volumeFile } from './account-json.ts';
export const SCENARIOS: readonly Scenario[] = ['savedLinks', 'relook', 'resumePick', 'letter', 'murky', 'testTask', 'jobOffer', 'hideJunk', 'invites', 'inviteAutoReply', 'quota'];
export function planFlagsPath() { return volumeFile('plan-flags.json'); }
export function createPlanFlags(file=planFlagsPath()) {
  const store=accountJson(file,'plan_flag');
  const row=(login:string)=>store.get(login) as {enabled?:boolean;scenarios?:Partial<Record<Scenario,boolean>>}|undefined;
  const scenarios=(login:string)=>Object.fromEntries(SCENARIOS.map(s=>[s,row(login)?.scenarios?.[s]===true])) as Record<Scenario,boolean>;
  return {
    enabled:(login:string)=>row(login)?.enabled===true,
    setEnabled:(login:string,enabled:boolean,_now=Date.now())=>store.set(login,{...row(login),enabled}),
    scenarios,
    setScenarios:(login:string,patch:unknown)=>{
      const clean=Object.fromEntries(SCENARIOS.filter(s=>s!=='inviteAutoReply' && typeof (patch as any)?.[s]==='boolean').map(s=>[s,(patch as any)[s]]));
      store.set(login,{...row(login),scenarios:{...scenarios(login),...clean}});
    },
    close:()=>store.close(),
  };
}
export type PlanFlags=ReturnType<typeof createPlanFlags>;
