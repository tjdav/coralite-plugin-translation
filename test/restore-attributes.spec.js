import { describe, test } from 'node:test'
import assert from 'node:assert'
import { restoreAttributes } from '../lib/block-utils.js'

describe('restoreAttributes', () => {
  test('restores forbidden attributes (class)', () => {
    const source = '<div class="original">Text</div>'
    const target = '<div class="translated">Text</div>'
    const result = restoreAttributes(source, target)
    assert.strictEqual(result, '<div class="original">Text</div>')
  })

  test('restores forbidden attributes (href)', () => {
    const source = '<a href="/original">Text</a>'
    const target = '<a href="/translated">Text</a>'
    const result = restoreAttributes(source, target)
    assert.strictEqual(result, '<a href="/original">Text</a>')
  })

  test('preserves allowed attributes (alt)', () => {
    const source = '<img src="img.png" alt="Original">'
    const target = '<img src="img.png" alt="Translated">'
    const result = restoreAttributes(source, target)
    // src is restored (if changed/missing, though here it matches), alt is preserved
    assert.strictEqual(result, '<img src="img.png" alt="Translated">')
  })

  test('preserves allowed attributes (title)', () => {
    const source = '<p title="Original">Text</p>'
    const target = '<p title="Translated">Text</p>'
    const result = restoreAttributes(source, target)
    assert.strictEqual(result, '<p title="Translated">Text</p>')
  })

  test('handles mixed allowed and forbidden attributes', () => {
    const source = '<img src="original.png" class="foo" alt="Original">'
    const target = '<img src="translated.png" class="bar" alt="Translated">'
    const result = restoreAttributes(source, target)
    // src -> original.png, class -> foo, alt -> Translated
    // Note: attribute order in serialization might vary, but for single tag usually predictable
    // checking presence via regex or parsing would be safer but exact string match is good if serializer is deterministic
    // coralite serializer seems deterministic
    assert.match(result, /src="original\.png"/)
    assert.match(result, /class="foo"/)
    assert.match(result, /alt="Translated"/)
  })

  test('removes hallucinated attributes', () => {
    const source = '<div>Text</div>'
    const target = '<div class="new" data-foo="bar">Text</div>'
    const result = restoreAttributes(source, target)
    assert.strictEqual(result, '<div>Text</div>')
  })

  test('restores missing forbidden attributes', () => {
    const source = '<a href="/link">Text</a>'
    const target = '<a>Text</a>'
    const result = restoreAttributes(source, target)
    assert.strictEqual(result, '<a href="/link">Text</a>')
  })

  test('restores missing allowed attributes (fallback to source)', () => {
    // If translation drops the alt, we expect it to be restored from source
    // because we copy source attributes first.
    const source = '<img src="img.png" alt="Original">'
    const target = '<img src="img.png">'
    const result = restoreAttributes(source, target)
    assert.strictEqual(result, '<img src="img.png" alt="Original">')
  })

  test('handles structure mismatch (tag count)', () => {
    const source = '<div><p>Text</p></div>'
    const target = '<div>Text</div>' // Missing p
    const result = restoreAttributes(source, target)
    assert.strictEqual(result, target) // Returns target unmodified
  })

  test('handles structure mismatch (tag name)', () => {
    const source = '<div>Text</div>'
    const target = '<span>Text</span>'
    const result = restoreAttributes(source, target)
    assert.strictEqual(result, target)
  })

  test('handles nested structure', () => {
    const source = '<div class="orig"><p id="p1">Text</p></div>'
    const target = '<div class="trans"><p id="p2">Text</p></div>'
    const result = restoreAttributes(source, target)
    assert.strictEqual(result, '<div class="orig"><p id="p1">Text</p></div>')
  })
})
