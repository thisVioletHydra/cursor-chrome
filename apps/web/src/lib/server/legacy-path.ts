// Старый адрес раздела /admin/hh переехал на /admin/source.
// Возвращает новый адрес (с query) или null, если путь не старый.
export function legacyAdminPath(url: URL): string | null {
  const path = url.pathname;
  if (path !== '/admin/hh' && path.startsWith('/admin/hh/') === false)
    return null;

  return `/admin/source${path.slice('/admin/hh'.length)}${url.search}`;
}
