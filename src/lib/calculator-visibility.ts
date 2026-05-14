const KEY = 'calculator-hidden-cards';

export function getHiddenCards(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

export function hideCard(id: string): void {
  const current = getHiddenCards();
  if (!current.includes(id)) {
    localStorage.setItem(KEY, JSON.stringify([...current, id]));
  }
}

export function showCard(id: string): void {
  const current = getHiddenCards();
  localStorage.setItem(KEY, JSON.stringify(current.filter((x) => x !== id)));
}

export function isHidden(id: string, autoVisibilityResult: boolean): boolean {
  if (!autoVisibilityResult) return true;
  return getHiddenCards().includes(id);
}
