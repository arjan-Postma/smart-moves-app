export interface NlCardTranslation {
  subtitle: string;
  excerpt: string;
  keywords: string[];
}

export interface NlTranslations {
  cards: Record<string, NlCardTranslation>;
}

export async function fetchNlTranslations(): Promise<NlTranslations> {
  try {
    const res = await fetch('/translations/nl.json');
    if (!res.ok) return { cards: {} };
    return await res.json();
  } catch {
    return { cards: {} };
  }
}
