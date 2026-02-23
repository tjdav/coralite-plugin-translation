
/**
 * Creates a concurrent task queue to manage asynchronous tasks.
 *
 * @param {number} [concurrency=1] - The maximum number of concurrent tasks.
 * @returns {{ add: <T>(fn: () => Promise<T> | T) => Promise<T> }}
 */
export function createTranslationQueue (concurrency = 1) {
  const queue = []
  let activeCount = 0

  const next = () => {
    if (activeCount >= concurrency || queue.length === 0) {
      return
    }

    const { fn, resolve, reject } = queue.shift()
    activeCount++

    const promise = fn()

    // Handle both Promise and non-Promise return values
    Promise.resolve(promise)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        activeCount--
        next()
      })
  }

  return {
    /**
     * Adds a new task to the queue.
     *
     * @template T
     * @param {() => Promise<T> | T} fn - The async function to execute.
     * @returns {Promise<T>} A promise that resolves with the result of the task.
     */
    add (fn) {
      return new Promise((resolve, reject) => {
        queue.push({
          fn,
          resolve,
          reject
        })
        next()
      })
    }
  }
}
