export type GameEvents = {
  trick: { name: string; icon: string };
  score: { score: number; chain: string; multiplier: number; pending: number };
  bank: { points: number };
  bail: { reason: string };
  land: { impact: number; clean: boolean; combo: number };
  push: undefined;
  ollie: undefined;
  grind: { active: boolean; balance: number; material: 'metal' | 'concrete' };
  surface: { surface: 'concrete' | 'wood' };
  speed: { normalized: number; grounded: boolean };
};

type Handler<T> = (data: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set?.delete(handler as Handler<never>);
  }

  emit<K extends keyof GameEvents>(event: K, data: GameEvents[K]): void {
    this.handlers.get(event)?.forEach((handler) => (handler as Handler<GameEvents[K]>)(data));
  }
}
