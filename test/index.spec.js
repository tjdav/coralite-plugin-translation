import { test } from 'node:test'
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

test('serializeNode', async (t) => {
  await t.test('serializes text node', () => {
    const node = createText('Hello & World')
    assert.strictEqual(serializeNode(node), 'Hello &amp; World')
  })

  await t.test('serializes simple tag', () => {
    const node = createTag('p', [createText('Hello')], { class: 'greeting' })
    assert.strictEqual(serializeNode(node), '<p class="greeting">Hello</p>')
  })

  await t.test('serializes void tag', () => {
    const node = createTag('img', [], {
      src: 'img.jpg',
      alt: 'Image'
    })
    assert.strictEqual(serializeNode(node), '<img src="img.jpg" alt="Image">')
  })

  await t.test('serializes nested tags', () => {
    const node = createTag('div', [
      createTag('p', [createText('Hello')]),
      createTag('br')
    ])
    assert.strictEqual(serializeNode(node), '<div><p>Hello</p><br></div>')
  })

  await t.test('serializes boolean attributes correctly', () => {
    const node = createTag('input', [], {
      type: 'checkbox',
      checked: ''
    })
    assert.strictEqual(serializeNode(node), '<input type="checkbox" checked="">')
  })
})

test('prepareTranslationPayload', async (t) => {
  await t.test('wraps blocks in chunks', () => {
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
