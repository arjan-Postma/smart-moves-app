import { Platform } from 'react-native';

// ── Wix site configuration ─────────────────────────────────────────────────────
const SITE_ID = '27882056-1976-4b4a-8ea3-a2f80565bb53'; // Futures Academy (same site as TrendDeck)
const CATEGORY_ID = '2b713ec6-14eb-4033-be75-2bcd41dec80b'; // "Smart Moves" parent category

// On web: use same-origin proxy path (served by server.js). On native: call Wix directly.
const API_URL =
  Platform.OS === 'web'
    ? '/posts'
    : 'https://www.wixapis.com/blog/v3/posts/query';

// Sentinel category ID for the Archive category.
export const ARCHIVE_CATEGORY_ID = '__archive__';

export interface TrendCard {
  id: string;
  title: string;        // The move name (shown as the red-banner label on cards)
  subtitle: string;     // Same as title — used as the heading in the card body
  excerpt: string;      // First two paragraphs of content
  keywords: string[];   // "What would you do?" questions (up to 3)
  imageUrl: string;
  publishedDate: string;
  categoryIds: string[];
  hasRealTitle: boolean;
}

export interface TrendCategory {
  id: string;
  label: string;
  postCount: number;
}

// Parse the first N paragraphs from Wix contentText.
// Paragraphs are separated by double-spaces in the flattened text.
function parseParagraphs(contentText: string, count: number): string {
  const blocks = contentText.split('  ').map((b: string) => b.trim()).filter(Boolean);
  return blocks.slice(0, count).join('\n\n');
}

// Parse "What would you do?" questions from contentText.
// Looks for a block containing "What would you do" and takes up to 3 following
// blocks as the questions. Falls back to finding blocks that end with "?".
function parseQuestions(contentText: string): string[] {
  const blocks = contentText.split('  ').map((b: string) => b.trim()).filter(Boolean);

  const markerIdx = blocks.findIndex((b: string) =>
    /what would you do/i.test(b) || /wat zou jij doen/i.test(b)
  );

  if (markerIdx >= 0) {
    return blocks.slice(markerIdx + 1, markerIdx + 4).filter(Boolean);
  }

  // Fallback: collect blocks that look like questions
  const questions = blocks.filter((b: string) => b.trim().endsWith('?'));
  return questions.slice(0, 3);
}

export async function fetchTrendPosts(cursor?: string, categoryIds?: string[], limit = 20): Promise<{
  cards: TrendCard[];
  nextCursor?: string;
  total: number;
}> {
  const apiKey = process.env.EXPO_PUBLIC_WIX_API_KEY;
  const filterIds = categoryIds && categoryIds.length > 0 ? categoryIds : [CATEGORY_ID];

  const body: Record<string, unknown> = {
    query: {
      filter: { categoryIds: { $hasSome: filterIds } },
      sort: [{ fieldName: 'firstPublishedDate', order: 'DESC' }],
      ...(cursor
        ? { cursorPaging: { cursor } }
        : { paging: { limit } }),
    },
    fieldsets: ['URL', 'CONTENT_TEXT'],
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (Platform.OS !== 'web' && apiKey && apiKey !== 'your_wix_api_key_here') {
    headers['Authorization'] = apiKey;
    headers['wix-site-id'] = SITE_ID;
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error('Not able to connect to server');
  }

  const data = await response.json();

  const cards: TrendCard[] = (data.posts || []).map((post: any) => {
    const rawTitle = (post.title || '').trim();
    const contentText = post.contentText || '';

    // First two paragraphs become the body
    const excerpt = parseParagraphs(contentText, 2);

    // "What would you do?" questions replace the keywords section
    const questions = parseQuestions(contentText);

    return {
      id: post.id,
      title: rawTitle,
      subtitle: rawTitle,   // title doubles as subtitle heading on the card
      excerpt,
      keywords: questions,  // keywords field reused for questions
      imageUrl: post.media?.wixMedia?.image?.url || '',
      publishedDate: post.firstPublishedDate || '',
      categoryIds: post.categoryIds || [],
      hasRealTitle: true,
    };
  });

  if (Platform.OS === 'web') {
    console.log(
      '[fetchTrendPosts] first 3 post categoryIds:',
      cards.slice(0, 3).map((c) => ({ id: c.id, categoryIds: c.categoryIds }))
    );
  }

  return {
    cards,
    nextCursor: data.pagingMetadata?.cursors?.next,
    total: data.pagingMetadata?.total || data.metaData?.total || 0,
  };
}

// Smart Moves subcategories keyed by normalised Wix category name.
// Wix category names expected: "Smart Moves Change", "Smart Moves Design", etc.
const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  'change':   'Change',
  'design':   'Design',
  'learn':    'Learn',
  'system':   'System',
  'culture':  'Culture',
  'strategy': 'Strategy',
  'impact':   'Impact',
};

export async function fetchCategories(): Promise<TrendCategory[]> {
  const res = await fetch(
    Platform.OS === 'web' ? '/categories' : 'https://www.wixapis.com/blog/v3/categories/query',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { paging: { limit: 50 } } }),
    }
  );
  if (!res.ok) return [];
  const data = await res.json();

  function getTitle(c: any): string {
    return (c.title || c.label || c.name || '').trim();
  }

  // Keep only "Smart Moves <subcategory>" entries, excluding the bare parent
  const smartMovesCategories = (data.categories || []).filter((c: any) => {
    const t = getTitle(c).toLowerCase();
    return t.startsWith('smart move') && !/^smart moves?$/.test(t);
  });

  // Strip "Smart Moves " prefix and map to canonical display name
  const mapped: TrendCategory[] = smartMovesCategories.map((c: any) => {
    const raw = getTitle(c).replace(/^smart moves?\s+/i, '').trim();
    const key = raw.toLowerCase();
    const displayName = CATEGORY_DISPLAY_NAMES[key];
    return {
      id: c.id,
      label: displayName || raw || getTitle(c),
      postCount: typeof c.postCount === 'number' ? c.postCount : 0,
    };
  });

  console.log('[fetchCategories] Smart Moves categories:',
    JSON.stringify(mapped.map((c) => ({ id: c.id, label: c.label, postCount: c.postCount }))));

  // Deduplicate: keep the entry with the highest postCount per display label
  const best = new Map<string, TrendCategory>();
  for (const cat of mapped) {
    const existing = best.get(cat.label);
    if (!existing || cat.postCount > existing.postCount) {
      best.set(cat.label, cat);
    }
  }
  const result = Array.from(best.values());

  // Sort by preferred order
  const order = ['Change', 'Design', 'Learn', 'System', 'Culture', 'Strategy', 'Impact'];
  return result.sort(
    (a, b) =>
      (order.indexOf(a.label) === -1 ? 999 : order.indexOf(a.label)) -
      (order.indexOf(b.label) === -1 ? 999 : order.indexOf(b.label))
  );
}
