/**
 * Create an Error annotated with an HTTP status code.
 *
 * Sets both `status` and `statusCode` to the same value so that every error
 * consumer in the codebase resolves a consistent code regardless of which
 * field it reads.
 *
 * @param {string} message - Human-readable error message.
 * @param {number} status - HTTP status code to attach.
 * @returns {Error} Error with `status` and `statusCode` set.
 */
export function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
}
