import type {
  PawApiNamespace,
  PawDependencyAction,
  PawDependencySnapshot,
  PawDependenciesNamespace,
  PawDependencyActionOptions,
  PawDisposable,
} from "./types";

export function createDependenciesNamespace(
  api: PawApiNamespace,
): PawDependenciesNamespace {
  const list = (force = false): Promise<PawDependencySnapshot[]> =>
    api.get<PawDependencySnapshot[]>("/dependencies", {
      query: force ? { force: true } : undefined,
    });

  return {
    list,
    get: (dependencyId: string, force = false): Promise<PawDependencySnapshot> =>
      api.get<PawDependencySnapshot>(
        `/dependencies/${encodeURIComponent(dependencyId)}`,
        { query: force ? { force: true } : undefined },
      ),
    check: (dependencyId: string): Promise<PawDependencySnapshot> =>
      api.post<PawDependencySnapshot>(
        `/dependencies/${encodeURIComponent(dependencyId)}/actions/check`,
      ),
    action: (
      dependencyId: string,
      action: PawDependencyAction,
      options?: PawDependencyActionOptions,
    ): Promise<PawDependencySnapshot> =>
      api.post<PawDependencySnapshot>(
        `/dependencies/${encodeURIComponent(
          dependencyId,
        )}/actions/${encodeURIComponent(action)}`,
        undefined,
        options?.idempotencyKey
          ? { headers: { "Idempotency-Key": options.idempotencyKey } }
          : undefined,
      ),
    restart: (
      dependencyId: string,
      action: PawDependencyAction,
      options?: PawDependencyActionOptions,
    ): Promise<PawDependencySnapshot> =>
      api.post<PawDependencySnapshot>(
        `/dependencies/${encodeURIComponent(
          dependencyId,
        )}/actions/${encodeURIComponent(action)}`,
        undefined,
        options?.idempotencyKey
          ? { headers: { "Idempotency-Key": options.idempotencyKey } }
          : undefined,
      ),
    subscribe(
      listener: (snapshot: PawDependencySnapshot) => void,
      options: { intervalMs?: number; force?: boolean } = {},
    ): PawDisposable {
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const intervalMs = Math.max(1_000, options.intervalMs ?? 10_000);

      const poll = async () => {
        try {
          const snapshots = await list(Boolean(options.force));
          if (!disposed) {
            for (const snapshot of snapshots) listener(snapshot);
          }
        } catch {
          // Transient failures are reflected by the next successful snapshot;
          // consumers can still issue an explicit list() call for typed errors.
        } finally {
          if (!disposed) timer = setTimeout(poll, intervalMs);
        }
      };

      void poll();
      return {
        dispose() {
          disposed = true;
          if (timer) clearTimeout(timer);
        },
      };
    },
  };
}

export type { PawDependencyAction };
