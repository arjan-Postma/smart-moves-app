import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Collection {
  id: string;
  name: string;
  cardIds: string[];
}

const KEY = 'trend_collections';

export async function getCollections(): Promise<Collection[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveCollections(cols: Collection[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cols));
  } catch {}
}
