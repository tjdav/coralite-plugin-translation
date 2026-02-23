
import { test } from 'node:test'
import assert from 'node:assert'
import { createTranslationQueue } from '../lib/queue.js'

test('createTranslationQueue', async (t) => {
  await t.test('executes tasks sequentially with concurrency 1', async () => {
    const queue = createTranslationQueue(1)
    const results = []

    const task1 = () => new Promise(resolve => setTimeout(() => {
      results.push(1); resolve(1)
    }, 50))
    const task2 = () => new Promise(resolve => setTimeout(() => {
      results.push(2); resolve(2)
    }, 10))

    await Promise.all([queue.add(task1), queue.add(task2)])

    assert.deepStrictEqual(results, [1, 2])
  })

  await t.test('executes tasks concurrently with concurrency > 1', async () => {
    const queue = createTranslationQueue(2)
    const results = []

    const task1 = () => new Promise(resolve => setTimeout(() => {
      results.push(1); resolve(1)
    }, 50))
    const task2 = () => new Promise(resolve => setTimeout(() => {
      results.push(2); resolve(2)
    }, 10))

    await Promise.all([queue.add(task1), queue.add(task2)])

    // Task 2 finishes first because it's faster and runs concurrently
    assert.deepStrictEqual(results, [2, 1])
  })

  await t.test('respects concurrency limit', async () => {
    const queue = createTranslationQueue(2)
    let active = 0
    let maxActive = 0

    const task = () => new Promise(resolve => {
      active++
      maxActive = Math.max(maxActive, active)
      setTimeout(() => {
        active--
        resolve()
      }, 20)
    })

    const tasks = [queue.add(task), queue.add(task), queue.add(task), queue.add(task)]

    await Promise.all(tasks)

    assert.strictEqual(maxActive, 2)
  })

  await t.test('handles task rejection', async () => {
    const queue = createTranslationQueue(1)
    const error = new Error('Task failed')

    try {
      await queue.add(() => Promise.reject(error))
      assert.fail('Should have thrown')
    } catch (err) {
      assert.strictEqual(err, error)
    }
  })
})
