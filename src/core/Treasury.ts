/**
 * Stub treasury: a single balance that placement spends from. There is no economy simulation yet;
 * this exists so building costs are real and the UI has something to show.
 */
export class Treasury {
  private readonly listeners = new Set<(funds: number) => void>();

  constructor(private balance: number) {}

  get funds() {
    return this.balance;
  }

  canAfford(cost: number) {
    return this.balance >= cost;
  }

  /** Spend `cost` if affordable. Returns whether the purchase went through. */
  spend(cost: number): boolean {
    if (cost < 0 || !this.canAfford(cost)) return false;
    this.balance -= cost;
    this.emit();
    return true;
  }

  /** Set the balance outright (restoring a saved game). */
  set(value: number) {
    this.balance = value;
    this.emit();
  }

  add(amount: number) {
    this.balance += amount;
    this.emit();
  }

  onChange(fn: (funds: number) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.balance);
  }
}
