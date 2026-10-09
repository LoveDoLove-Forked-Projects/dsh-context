/** The host `connection` service seam every plugin fetch route (detail, backfill trigger, balance,
 * skills) registers through. One home for the face and the bind-at-extraction guard: an unbound
 * hand-off loses `this` on the real face. */

export interface ConnectionHostFace {
  fetch?: {
    register?(route: {
      path: string
      methods: readonly string[]
      requestBody: 'buffered'
      fetch: (request: Request) => Response | Promise<Response>
    }): () => void
  }
}

/** The route registrar off the face, bound at extraction. */
export function fetchRouteRegistrar(connection: ConnectionHostFace | undefined) {
  return typeof connection?.fetch?.register === 'function'
    ? connection.fetch.register.bind(connection.fetch)
    : undefined
}
