import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@planner_v1';

export type PostState = 'unscheduled' | 'scheduled' | 'published';

export interface PlannedPost {
  cardId: string;
  scheduledDate: string | null; // 'YYYY-MM-DD'
  state: PostState;
}

export type PlannerData = Record<string, PlannedPost>;

export async function getPlannerData(): Promise<PlannerData> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function savePlannerData(data: PlannerData): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}
