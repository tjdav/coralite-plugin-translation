/**
 * Type guard to safely check if a value is an async generator/iterable.
 *
 * @template T
 * @param {any} val
 * @returns {val is AsyncGenerator<T>}
 */
function isAsyncGenerator (val) {
  return val !== null && typeof val === 'object' && typeof val[Symbol.asyncIterator] === 'function'
}

/**
 * Creates a sequential promise queue to manage asynchronous tasks.
 * Ensures tasks are executed one at a time to respect API rate limits.
 *
 * @returns {{ add: <T>(fn: () => Promise<T> | AsyncGenerator<T>) => AsyncGenerator<T> }}
 */
export function createTranslationQueue () {
  /**
   * The tail of the promise chain.
   * @type {Promise<any>}
   */
  let queue = Promise.resolve()

  return {
    /**
     * Adds a new task to the queue.
     * Supports both Promise-returning functions and Async Generators.
     *
     * @template T
     * @param {() => Promise<T> | AsyncGenerator<T>} fn - The async function or generator to execute.
     * @returns {AsyncGenerator<T>} An async generator yielding results from the task.
     */
    async *add (fn) {
      // Create a new lock promise for this task
      /** @type {Function} */
      let releaseLock
      const lockPromise = new Promise(resolve => {
        releaseLock = resolve
      })

      // Wait for previous tasks
      const previousQueue = queue
      // Update queue pointer immediately to the new lock
      queue = queue.then(() => lockPromise)

      try {
        await previousQueue

        const result = fn()

        // Use the type guard to let TypeScript know this is strictly an AsyncGenerator
        if (isAsyncGenerator(result)) {
          try {
            // TS now knows `result` is AsyncGenerator<T>
            for await (const value of result) {
              yield value
            }
          } finally {
            releaseLock()
          }
        } else {
          // TS now knows `result` is strictly a Promise<T>
          try {
            yield await result
          } finally {
            releaseLock()
          }
        }
      } catch (error) {
        releaseLock() // Ensure queue continues even if task fails
        throw error
      }
    }
  }
}
