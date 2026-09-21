export type ApplyPayload = {
  title: string;
  company: string;
  url: string;
  vacancyId: string;
};

export function localDay(ms: number): string {
  const date = new Date(ms);

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function ask<T>(payload: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(payload, (data: T) => {
        if (chrome.runtime.lastError)
          resolve(null);
        else
          resolve(data ?? null);
      });
    }
    catch {
      resolve(null);
    }
  });
}
