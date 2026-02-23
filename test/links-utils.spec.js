import { describe, test } from 'node:test'
import assert from 'node:assert'
import { processRelativeLinks } from '../lib/link-utils.js'

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

describe('processRelativeLinks', () => {
  const targetLang = 'fr'

  test('converts root-relative link', () => {
    const root = createRoot([
      createTag('a', [createText('Home')], { href: '/index.html' })
    ])
    processRelativeLinks(root, targetLang, 'about.html')
    assert.strictEqual(root.children[0].attribs.href, '/fr/index.html')
  })

  test('converts relative link (same directory)', () => {
    const root = createRoot([
      createTag('a', [createText('Blog')], { href: 'blog.html' })
    ])
    // Base: http://dummy.com/index.html -> href: http://dummy.com/blog.html
    processRelativeLinks(root, targetLang, 'index.html')
    assert.strictEqual(root.children[0].attribs.href, '/fr/blog.html')
  })

  test('converts relative link (parent directory)', () => {
    const root = createRoot([
      createTag('a', [createText('Contact')], { href: '../contact.html' })
    ])
    // Base: http://dummy.com/blog/post.html -> href: http://dummy.com/contact.html
    processRelativeLinks(root, targetLang, 'blog/post.html')
    assert.strictEqual(root.children[0].attribs.href, '/fr/contact.html')
  })

  test('converts link with no extension', () => {
    const root = createRoot([
      createTag('a', [createText('Link')], { href: '/blog' })
    ])
    processRelativeLinks(root, targetLang, 'index.html')
    assert.strictEqual(root.children[0].attribs.href, '/fr/blog')
  })

  test('converts relative link with no extension', () => {
    const root = createRoot([
      createTag('a', [createText('Link')], { href: '../about' })
    ])
    // Base: http://dummy.com/blog/post.html -> href: http://dummy.com/about
    processRelativeLinks(root, targetLang, 'blog/post.html')
    assert.strictEqual(root.children[0].attribs.href, '/fr/about')
  })

  test('skips absolute URLs', () => {
    const root = createRoot([
      createTag('a', [createText('Google')], { href: 'https://google.com' })
    ])
    processRelativeLinks(root, targetLang, 'index.html')
    assert.strictEqual(root.children[0].attribs.href, 'https://google.com')
  })

  test('skips protocol-relative URLs', () => {
    const root = createRoot([
      createTag('a', [createText('External')], { href: '//example.com' })
    ])
    processRelativeLinks(root, targetLang, 'index.html')
    assert.strictEqual(root.children[0].attribs.href, '//example.com')
  })

  test('skips mailto links', () => {
    const root = createRoot([
      createTag('a', [createText('Email')], { href: 'mailto:test@example.com' })
    ])
    processRelativeLinks(root, targetLang, 'index.html')
    assert.strictEqual(root.children[0].attribs.href, 'mailto:test@example.com')
  })

  test('skips anchors (fragments)', () => {
    const root = createRoot([
      createTag('a', [createText('Top')], { href: '#top' })
    ])
    processRelativeLinks(root, targetLang, 'index.html')
    assert.strictEqual(root.children[0].attribs.href, '#top')
  })

  test('skips links with ignored extensions', () => {
    const root = createRoot([
      createTag('a', [createText('Image')], { href: '/image.png' }),
      createTag('a', [createText('Script')], { href: 'script.js' }),
      createTag('a', [createText('Style')], { href: '../style.css' })
    ])
    processRelativeLinks(root, targetLang, 'index.html')
    assert.strictEqual(root.children[0].attribs.href, '/image.png')
    assert.strictEqual(root.children[1].attribs.href, 'script.js')
    assert.strictEqual(root.children[2].attribs.href, '../style.css')
  })

  test('handles nested structures', () => {
    const root = createRoot([
      createTag('div', [
        createTag('p', [
          createTag('a', [createText('Deep Link')], { href: '/deep.html' })
        ])
      ])
    ])
    processRelativeLinks(root, targetLang, 'index.html')
    const div = root.children[0]
    const p = div.children[0]
    const a = p.children[0]
    assert.strictEqual(a.attribs.href, '/fr/deep.html')
  })

  test('preserves query params and hash on modified links', () => {
    const root = createRoot([
      createTag('a', [createText('Query')], { href: '/search?q=test#result' })
    ])
    processRelativeLinks(root, targetLang, 'index.html')
    assert.strictEqual(root.children[0].attribs.href, '/fr/search?q=test#result')
  })

  test('handles complex relative path traversal', () => {
    // Current page: /a/b/c.html
    // Link: ../../d/e.html -> /d/e.html -> /fr/d/e.html
    const root = createRoot([
      createTag('a', [createText('Complex')], { href: '../../d/e.html' })
    ])
    processRelativeLinks(root, targetLang, 'a/b/c.html')
    assert.strictEqual(root.children[0].attribs.href, '/fr/d/e.html')
  })

  test('handles current directory reference ./', () => {
    const root = createRoot([
      createTag('a', [createText('Current')], { href: './sibling.html' })
    ])
    // Base: http://dummy.com/dir/index.html -> http://dummy.com/dir/sibling.html
    processRelativeLinks(root, targetLang, 'dir/index.html')
    assert.strictEqual(root.children[0].attribs.href, '/fr/dir/sibling.html')
  })
})
