import { enhance as enhanceForm } from '$app/forms';

export const enhance: typeof enhanceForm = (form, submit) => {
  return enhanceForm(form, async (input) => {
    const callback = await submit?.(input);

    return async (output) => {
      const { result } = output;
      const expired = result.type === 'error' && result.status === 401;
      const loginRedirect = result.type === 'redirect' && result.location === '/?expired=1';
      if (expired || loginRedirect) {
        const letter = input.formData.get('coverLetter');
        if (typeof letter === 'string') {
          try {
            sessionStorage.setItem(`cover-letter:${form.dataset.login}`, letter);
          }
          catch {
            // Keep the form visible if browser storage cannot preserve the draft.
            await callback?.(output);
            return;
          }
        }
        window.location.assign('/?expired=1');
        return;
      }

      if (callback)
        await callback(output);
      else
        await output.update();
    };
  });
};
