/**
 * The host `connection` service seam every one of the plugin's fetch routes
 * (detail, backfill trigger, balance) registers through. One home for the
 * face and the bind-at-extraction guard: an unbound hand-off loses `this`
 * on the real face, and three copies of that incantation is two too many.
 */

/** The host `connection` service, as far as a fetch route consumes it. */
export interface ConnectionHostFace {
  fetch?: {
    // The handler's result is awaited by the transport, so sync and async
    // handlers both register.
    register?(route: {
      path: string
      methods: readonly string[]
      requestBody: 'buffered'
      fetch: (request: Request) => Response | Promise<Response>
    }): () => void
  }
}

/** The route registrar off the face, bound at extraction; undefined when the service serves no fetch routes. */
export function fetchRouteRegistrar(connection: ConnectionHostFace | undefined) {
  return typeof connection?.fetch?.register === 'function'
    ? connection.fetch.register.bind(connection.fetch)
    : undefined
}
