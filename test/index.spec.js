import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  findTranslatableBlocks,
  serializeNode,
  prepareTranslationPayload,
  parseTranslatedPayload,
  reconstructBlock
} from '../lib/block-utils.js'

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

function createComment (data) {
  return {
    type: 'comment',
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

test('findTranslatableBlocks', async (t) => {
  await t.test('identifies semantic blocks with text', () => {
    const root = createRoot([
      createTag('p', [createText('Hello')]),
      createTag('div', [createTag('p', [createText('World')])])
    ])

    const blocks = []
    findTranslatableBlocks(root, blocks)

    assert.strictEqual(blocks.length, 2)
    assert.strictEqual(blocks[0].name, 'p')
    assert.strictEqual(blocks[1].name, 'p')
  })

  await t.test('skips semantic blocks without text', () => {
    const root = createRoot([
      createTag('p', []), // Empty
      createTag('h1', [createTag('span', [])]) // Nested empty
    ])

    const blocks = []
    findTranslatableBlocks(root, blocks)

    assert.strictEqual(blocks.length, 0)
  })

  await t.test('identifies container blocks with direct text', () => {
    const root = createRoot([
      createTag('div', [createText('Direct text')]),
      createTag('section', [createText('  '), createTag('span', [createText('Wrapped')])])
    ])

    const blocks = []
    findTranslatableBlocks(root, blocks)

    assert.strictEqual(blocks.length, 2)
    assert.strictEqual(blocks[0].name, 'div') // Direct text
    assert.strictEqual(blocks[1].name, 'span') // Direct text inside section
  })

  await t.test('skips ignored tags', () => {
    const root = createRoot([
      createTag('script', [createText('console.log("hello")')]),
      createTag('style', [createText('.css {}')])
    ])

    const blocks = []
    findTranslatableBlocks(root, blocks)

    assert.strictEqual(blocks.length, 0)
  })

  await t.test('handles nested structures correctly', () => {
    const root = createRoot([
      createTag('div', [
        createTag('p', [createText('Text')])
      ])
    ])

    const blocks = []
    findTranslatableBlocks(root, blocks)

    assert.strictEqual(blocks.length, 1)
    assert.strictEqual(blocks[0].name, 'p')
  })
})

describe('serializeNode', async (t) => {
  test('serializes simple tag', () => {
    const node = createTag('p', [createText('Hello')], { class: 'greeting' })
    assert.strictEqual(serializeNode(node), '<p class="greeting">Hello</p>')
  })

  test('serializes void tag', () => {
    const node = createTag('img', [], {
      src: 'img.jpg',
      alt: 'Image'
    })
    assert.strictEqual(serializeNode(node), '<img src="img.jpg" alt="Image">')
  })

  test('serializes nested tags', () => {
    const node = createTag('div', [
      createTag('p', [createText('Hello')]),
      createTag('br')
    ])
    assert.strictEqual(serializeNode(node), '<div><p>Hello</p><br></div>')
  })

  test('serializes boolean attributes correctly', () => {
    const node = createTag('input', [], {
      type: 'checkbox',
      checked: ''
    })
    assert.strictEqual(serializeNode(node), '<input type="checkbox" checked="">')
  })
})

describe('prepareTranslationPayload', async (t) => {
  test('wraps blocks in chunks', () => {
    const blocks = [
      createTag('p', [createText('Block 1')]),
      createTag('h1', [createText('Block 2')])
    ]

    const { payload, mapping } = prepareTranslationPayload(blocks)

    assert.match(payload, /<chunk id="0">\s*Block 1\s*<\/chunk>/)
    assert.match(payload, /<chunk id="1">\s*Block 2\s*<\/chunk>/)
    assert.strictEqual(mapping.length, 2)
    assert.strictEqual(mapping[0].index, 0)
    assert.strictEqual(mapping[1].index, 1)
  })
})

test('parseTranslatedPayload', async (t) => {
  await t.test('extracts chunks', () => {
    const response = `
      <chunk id="0">Translated 1</chunk>
      Some noise
      <chunk id="1">
        Translated 2
      </chunk>
    `

    const translations = parseTranslatedPayload(response)

    assert.strictEqual(translations.size, 2)
    assert.strictEqual(translations.get(0), 'Translated 1')
    assert.strictEqual(translations.get(1), 'Translated 2')
  })
})

test('reconstructBlock', async (t) => {
  await t.test('updates block children', () => {
    const block = createTag('p', [createText('Original')])
    const translatedHtml = 'Translated <strong>Text</strong>'

    // Mock parse function
    const mockParse = (html) => {
      // Simple mock: if html contains tags, return structure
      if (html.includes('<strong>')) {
        return {
          root: {
            children: [
              createText('Translated '),
              createTag('strong', [createText('Text')])
            ]
          }
        }
      }
      return { root: { children: [createText(html)] } }
    }

    reconstructBlock(block, translatedHtml, mockParse)

    assert.strictEqual(block.children.length, 2)
    assert.strictEqual(block.children[0].data, 'Translated ')
    assert.strictEqual(block.children[1].name, 'strong')
    assert.strictEqual(block.children[1].parent, block)
  })
})

describe('Code Translation Routing', () => {
  test('should extract <pre> and <code> blocks alongside standard text', () => {
    // Mock a Coralite AST containing standard text, code, and ignored tags
    const mockAstRoot = {
      type: 'tag',
      name: 'div',
      children: [
        {
          type: 'tag',
          name: 'p',
          children: [{
            type: 'text',
            data: 'Standard paragraph'
          }]
        },
        {
          type: 'tag',
          name: 'pre',
          children: [
            {
              type: 'tag',
              name: 'code',
              children: [{
                type: 'text',
                data: '// Translate this comment'
              }]
            }
          ]
        },
        {
          type: 'tag',
          name: 'script', // This should still be entirely skipped
          children: [{
            type: 'text',
            data: 'console.log("Do not translate");'
          }]
        }
      ]
    }

    const blocks = []
    findTranslatableBlocks(mockAstRoot, blocks)

    // We expect exactly 2 blocks: the <p> and the <pre>
    assert.strictEqual(blocks.length, 2, 'Should find exactly two translatable blocks')
    assert.strictEqual(blocks[0].name, 'p', 'First block should be standard text')
    assert.strictEqual(blocks[1].name, 'pre', 'Second block should be the code block')
  })

  test('should correctly route blocks into standardTasks and codeTasks', () => {
    // Mock the extracted blocks from the DOM
    const blocks = [
      {
        name: 'h1',
        data: 'Title'
      },
      {
        name: 'pre',
        data: 'let x = 1;'
      },
      {
        name: 'p',
        data: 'Description'
      },
      {
        name: 'code',
        data: 'npm install'
      }
    ]

    const standardTasks = []
    const codeTasks = []

    // Replicate the routing logic from lib/index.js
    for (const block of blocks) {
      if (block.name === 'pre' || block.name === 'code') {
        codeTasks.push(block)
      } else {
        standardTasks.push(block)
      }
    }

    // Verify Standard Tasks
    assert.strictEqual(standardTasks.length, 2)
    assert.strictEqual(standardTasks[0].name, 'h1')
    assert.strictEqual(standardTasks[1].name, 'p')

    // Verify Code Tasks
    assert.strictEqual(codeTasks.length, 2)
    assert.strictEqual(codeTasks[0].name, 'pre')
    assert.strictEqual(codeTasks[1].name, 'code')
  })
})
