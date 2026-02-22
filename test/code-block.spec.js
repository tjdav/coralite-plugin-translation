import { describe, test } from 'node:test'
import assert from 'node:assert'
import { findTranslatableBlocks } from '../lib/block-utils.js'

// Mock AST helpers
function createTag (name, children = [], attribs = {}) {
  const node = {
    type: 'tag',
    name,
    children,
    attribs
  }
  children.forEach(c => {
    if (typeof c === 'object') c.parent = node
  })
  return node
}

function createText (data) {
  return {
    type: 'text',
    data
  }
}

function createRoot (children = []) {
  const node = {
    type: 'root',
    children
  }
  children.forEach(c => {
    if (typeof c === 'object') c.parent = node
  })
  return node
}

describe('Code Blocks Detection', async (t) => {
  test('detects <pre> and <code> blocks', () => {
    const root = createRoot([
      createTag('pre', [createTag('code', [createText('var x = 1;')])]),
      createTag('code', [createText('standalone code')])
    ])

    const blocks = []
    findTranslatableBlocks(root, blocks)

    // Expectation: detected
    assert.strictEqual(blocks.length, 2, 'Should find 2 blocks')
    assert.strictEqual(blocks[0].name, 'pre')
    assert.strictEqual(blocks[1].name, 'code')
  })

  test('handles inline <code> as part of parent block', () => {
    const root = createRoot([
      createTag('p', [
        createText('Check '),
        createTag('code', [createText('this')]),
        createText(' out.')
      ])
    ])

    const blocks = []
    findTranslatableBlocks(root, blocks)

    // Expectation: p is the block, code is child
    assert.strictEqual(blocks.length, 1)
    assert.strictEqual(blocks[0].name, 'p')
  })
})
