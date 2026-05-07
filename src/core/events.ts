import type { AgentEvent } from "./types.js";

export class EventLog {
  private readonly events: AgentEvent[] = [];

  append(event: AgentEvent): AgentEvent {
    this.events.push(event);
    return event;
  }

  restore(events: AgentEvent[]): void {
    this.events.length = 0;
    this.events.push(...events);
  }

  list(): AgentEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}
