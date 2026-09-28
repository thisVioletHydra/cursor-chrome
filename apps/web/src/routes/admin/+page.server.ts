import { importSetupAdmin, setLiveAdmin } from '$lib/server/admin-actions';

export const actions = {
  import: importSetupAdmin,
  live: setLiveAdmin,
};
