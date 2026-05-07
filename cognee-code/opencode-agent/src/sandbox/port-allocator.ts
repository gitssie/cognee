/**
 * Port allocation for per-sandbox OpenCode servers.
 * In-memory only — sandboxes are transient.
 */
export class PortAllocator {
  private inUse: Set<number> = new Set();

  constructor(
    private readonly portStart: number,
    private readonly portEnd: number,
  ) {}

  allocate(): number {
    for (let port = this.portStart; port <= this.portEnd; port++) {
      if (!this.inUse.has(port)) {
        this.inUse.add(port);
        return port;
      }
    }
    throw new Error(
      `No free ports in range ${this.portStart}-${this.portEnd}. ` +
      `All ${this.portEnd - this.portStart + 1} ports are allocated.`,
    );
  }

  release(port: number): void {
    this.inUse.delete(port);
  }
}
