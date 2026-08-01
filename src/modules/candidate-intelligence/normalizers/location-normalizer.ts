export function normalizeCity(city: string | null): string | null {
  if (!city) return null;
  return city
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .trim();
}

export function normalizeState(state: string | null): string | null {
  if (!state) return null;
  return state
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .trim();
}

export function normalizeCountry(country: string | null): string | null {
  if (!country) return null;
  return country
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .trim();
}
