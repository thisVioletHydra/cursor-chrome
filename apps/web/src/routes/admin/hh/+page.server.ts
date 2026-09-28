import type { Actions, PageServerLoad } from './$types';

import { corpusState, parseRules } from '@cursor-chrome/hh';
import { distillAdmin, issueExtTokenAdmin, saveAppAdmin, saveCorpusAdmin, saveQueryAdmin, saveResumeAdmin, saveRulesAdmin, suggestQueryAdmin, unlinkAdmin, verifyAdmin } from '$lib/server/admin-actions';
import { isCreator, readAccount } from '$lib/server/secrets';
import { allowedLogins, readSession } from '$lib/server/session';

const emptyRules = {
  stopWords: '',
  mustWords: '',
  salaryMin: '',
  blacklist: '',
  corpusOn: false,
  corpusCount: 0,
  corpusBrief: '',
};

export const load: PageServerLoad = async ({ cookies }) => {
  const session = readSession(cookies.get('session'));
  if (session === null || allowedLogins().includes(session.login) === false)
    return emptyRules;

  if (isCreator(session.login) && cookies.get('preview') === 'guest')
    return emptyRules;

  const account = await readAccount(session.login);
  const corpus = await corpusState();

  return {
    ...ruleFields(account.hhRules),
    corpusOn: account.hhCorpus === '1',
    corpusCount: corpus.count,
    corpusBrief: corpus.brief,
  };
};

function ruleFields(raw: string) {
  const rules = parseRules(parsedRules(raw));

  return {
    stopWords: rules.stopWords.join('\n'),
    mustWords: rules.mustWords.join('\n'),
    salaryMin: rules.salaryMin > 0 ? String(rules.salaryMin) : '',
    blacklist: rules.blacklist.join('\n'),
  };
}

function parsedRules(raw: string): unknown {
  if (raw.length === 0)
    return null;

  try {
    return JSON.parse(raw);
  }
  catch {
    return null;
  }
}

export const actions: Actions = {
  verify: verifyAdmin,
  app: saveAppAdmin,
  resume: saveResumeAdmin,
  query: saveQueryAdmin,
  rules: saveRulesAdmin,
  corpus: saveCorpusAdmin,
  distill: distillAdmin,
  suggest: suggestQueryAdmin,
  extToken: issueExtTokenAdmin,
  unlink: unlinkAdmin,
};
