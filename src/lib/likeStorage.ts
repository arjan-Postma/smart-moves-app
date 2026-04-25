import AsyncStorage from '@react-native-async-storage/async-storage';

// Stored as an ordered array — index 0 = most recently liked.
// Backward-compatible: if the stored value is a plain array of IDs it still works.
const LIKES_KEY = 'trend_liked_ids';

export async function getLikedIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(LIKES_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

/** Returns IDs in like-order: index 0 = most recently liked. */
export async function getLikedOrder(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(LIKES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function toggleLike(postId: string): Promise<boolean> {
  const order = await getLikedOrder();
  const idx = order.indexOf(postId);
  if (idx !== -1) {
    // Unlike — remove from list
    order.splice(idx, 1);
    await AsyncStorage.setItem(LIKES_KEY, JSON.stringify(order));
    return false;
  } else {
    // Like — prepend so most recent is at index 0
    order.unshift(postId);
    await AsyncStorage.setItem(LIKES_KEY, JSON.stringify(order));
    return true;
  }
}
