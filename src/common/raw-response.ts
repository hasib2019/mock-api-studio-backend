/**
 * Opt-out of the `{ ok: true, data }` envelope for one route - used by the
 * project export endpoint, whose response has to be usable as-is by Swagger
 * UI / Postman / the import route, not wrapped for the studio's own fetch
 * client. `ApiEnvelopeInterceptor` unwraps it before the body is sent.
 */
export class RawResponse<T> {
  constructor(public readonly body: T) {}
}
