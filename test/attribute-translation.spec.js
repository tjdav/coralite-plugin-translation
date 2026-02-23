
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { parseHTML } from 'coralite'
import { findTranslatableBlocks, prepareTranslationPayload, hasTranslatableAttributes, reconstructBlock } from '../lib/block-utils.js'

describe('Attribute Translation', () => {
  it('should find elements with translatable attributes even without text content', () => {
    const html = `
      <a href="#" class="back-to-top visible" aria-label="Back to top" data-coralite-ref="coralite-back-to-top__backToTopBtn-11">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 15l-6-6-6 6"></path>
        </svg>
      </a>
    `
    const parsed = parseHTML(html)
    const blocks = []
    findTranslatableBlocks(parsed.root, blocks)

    assert.strictEqual(blocks.length, 1)
    assert.strictEqual(blocks[0].name, 'a')
    assert.strictEqual(hasTranslatableAttributes(blocks[0]), true)
  })

  it('should prepare payload with outer HTML for attribute blocks', () => {
    const html = `<a href="#" aria-label="Label"></a>`
    const parsed = parseHTML(html)
    const blocks = []
    findTranslatableBlocks(parsed.root, blocks)

    const { payload, mapping } = prepareTranslationPayload(blocks)

    // Should contain the outer tag
    assert.ok(payload.includes('<a href="#" aria-label="Label">'))
    assert.ok(mapping[0].originalHtml.startsWith('<a'))
  })

  it('should reconstruct block with updated attributes when useOuter is true', () => {
    const html = `<a href="#" aria-label="Old"></a>`
    const parsed = parseHTML(html)
    // @ts-ignore
    const block = parsed.root.children.find(c => c.name === 'a')

    const translatedHtml = `<a href="#" aria-label="New"></a>`

    reconstructBlock(block, translatedHtml, parseHTML, true)

    // @ts-ignore
    assert.strictEqual(block.attribs['aria-label'], 'New')
  })

  it('should reconstruct block correctly even with whitespace around outer tag', () => {
    const html = `<a href="#" aria-label="Old"></a>`
    const parsed = parseHTML(html)
    // @ts-ignore
    const block = parsed.root.children.find(c => c.name === 'a')

    // Simulating LLM response with whitespace
    const translatedHtml = `\n  <a href="#" aria-label="New"></a> \n`

    reconstructBlock(block, translatedHtml, parseHTML, true)

    // @ts-ignore
    assert.strictEqual(block.attribs['aria-label'], 'New')
    // Ensure children are empty (as in original/translated)
    // @ts-ignore
    assert.strictEqual(block.children.length, 0)
  })

  it('should preserve non-translatable attributes even if omitted in translation (when useOuter is true)', () => {
    const html = `<a href="#" class="btn" aria-label="Old"></a>`
    const parsed = parseHTML(html)
    // @ts-ignore
    const block = parsed.root.children.find(c => c.name === 'a')

    // LLM returns translated aria-label but omits class
    // Note: In real flow, restoreAttributes would fix this. But here we test reconstructBlock safety.
    const translatedHtml = `<a href="#" aria-label="New"></a>`

    reconstructBlock(block, translatedHtml, parseHTML, true)

    // @ts-ignore
    assert.strictEqual(block.attribs['aria-label'], 'New')
    // @ts-ignore
    assert.strictEqual(block.attribs['class'], 'btn') // Should be preserved
  })
})
