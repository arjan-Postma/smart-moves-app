import AsyncStorage from '@react-native-async-storage/async-storage';

const READ_KEY = 'trend_read_ids_v2'; // v2: deliberate tracking only (swipe past / tap)

export async function getReadIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function saveReadIds(ids: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch {}
}
