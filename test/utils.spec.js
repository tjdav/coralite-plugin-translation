import { describe, test } from 'node:test'
import assert from 'node:assert'
import { validateOptions } from '../lib/utils.js'

describe('Utils.js', () =>{
  test('validateOptions should throw if sourceLanguage is missing', () => {
    assert.throws(() => {
      validateOptions({})
    }, {
      message: 'Translation plugin requires "sourceLanguage" option.'
    })
  })

  test('validateOptions should throw if targetLanguages is missing', () => {
    assert.throws(() => {
      validateOptions({ sourceLanguage: 'en' })
    }, {
      message: 'Translation plugin requires "targetLanguages" array option.'
    })
  })

  test('validateOptions should throw if targetLanguages is not an array', () => {
    assert.throws(() => {
      validateOptions({
        sourceLanguage: 'en',
        targetLanguages: 'fr'
      })
    }, {
      message: 'Translation plugin requires "targetLanguages" array option.'
    })
  })

  test('validateOptions should not throw if all options are valid', () => {
    assert.doesNotThrow(() => {
      validateOptions({
        sourceLanguage: 'en',
        targetLanguages: ['fr', 'de']
      })
    })
  })
})
