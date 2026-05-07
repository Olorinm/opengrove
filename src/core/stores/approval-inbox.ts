import type { ApprovalRequest, ApprovalStatus, JsonValue } from "../types.js";

export class ApprovalInbox {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly waiters = new Map<string, Set<(request: ApprovalRequest) => void>>();
  private sequence = 0;

  request(input: Omit<ApprovalRequest, "id" | "status" | "createdAt" | "updatedAt">): ApprovalRequest {
    const now = new Date().toISOString();
    const request: ApprovalRequest = {
      ...input,
      id: `approval_${++this.sequence}`,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    this.requests.set(request.id, request);
    return request;
  }

  restore(requests: ApprovalRequest[]): void {
    this.requests.clear();
    this.sequence = 0;

    for (const request of requests) {
      this.requests.set(request.id, request);
      const match = request.id.match(/^approval_(\d+)$/);
      if (match) {
        this.sequence = Math.max(this.sequence, Number(match[1]));
      }
    }
  }

  get(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  list(status?: ApprovalStatus): ApprovalRequest[] {
    const requests = Array.from(this.requests.values());
    return status ? requests.filter((request) => request.status === status) : requests;
  }

  decide(
    id: string,
    status: Exclude<ApprovalStatus, "pending">,
    response?: JsonValue,
  ): ApprovalRequest {
    const request = this.requests.get(id);
    if (!request) {
      throw new Error(`Approval request not found: ${id}`);
    }

    if (request.status !== "pending") {
      if (request.status !== status) {
        throw new Error(`Approval request already ${request.status}: ${id}`);
      }
      return request;
    }

    const updated = {
      ...request,
      status,
      ...(response !== undefined ? { response } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.requests.set(id, updated);
    this.notifyWaiters(updated);
    return updated;
  }

  waitForDecision(
    id: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<ApprovalRequest> {
    const request = this.requests.get(id);
    if (!request) {
      return Promise.reject(new Error(`Approval request not found: ${id}`));
    }
    if (request.status !== "pending") {
      return Promise.resolve(request);
    }

    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let cleanupAbort: (() => void) | undefined;
      const waiter = (updated: ApprovalRequest) => {
        if (updated.status === "pending") {
          return;
        }
        cleanup();
        resolve(updated);
      };
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        cleanupAbort?.();
        const waiters = this.waiters.get(id);
        waiters?.delete(waiter);
        if (waiters && waiters.size === 0) {
          this.waiters.delete(id);
        }
      };

      const waiters = this.waiters.get(id) ?? new Set<(request: ApprovalRequest) => void>();
      waiters.add(waiter);
      this.waiters.set(id, waiters);

      if (options.timeoutMs && options.timeoutMs > 0) {
        timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Approval request timed out: ${id}`));
        }, options.timeoutMs);
      }

      if (options.signal) {
        if (options.signal.aborted) {
          cleanup();
          reject(new Error(`Approval request aborted: ${id}`));
          return;
        }
        const onAbort = () => {
          cleanup();
          reject(new Error(`Approval request aborted: ${id}`));
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        cleanupAbort = () => options.signal?.removeEventListener("abort", onAbort);
      }
    });
  }

  private notifyWaiters(request: ApprovalRequest): void {
    const waiters = this.waiters.get(request.id);
    if (!waiters) {
      return;
    }
    for (const waiter of Array.from(waiters)) {
      waiter(request);
    }
  }
}
