const rawApiBase = (
  (typeof window !== 'undefined' && (window as any).BACKEND_URL) ||
  import.meta.env.VITE_API_BASE_URL ||
  ''
).trim().replace(/\/$/, '');

export const API_BASE_URL = rawApiBase;

export function apiUrl(path: string) {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path}`;
}
