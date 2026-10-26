export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503,
    message: string,
  ) {
    super(message)
  }
}

/** An operation that cannot be applied (for example, the item was deleted on another device). */
export class OpRejected extends Error {}
