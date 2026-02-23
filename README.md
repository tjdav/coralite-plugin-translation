# coralite-plugin-translation

A translation plugin for Coralite that uses OpenAI API to translate page content.

## Installation

```bash
pnpm add coralite-plugin-translation
```

## Usage

```javascript
import { Coralite } from 'coralite'
import { translation } from '@coralite/plugin-translation'

const coralite = new Coralite({
  pages: './pages',
  templates: './templates',
  plugins: [
    translation({
      sourceLanguage: 'en',
      targetLanguages: ['en', 'fr', 'es'],
      concurrency: 5,
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o'
      },
      exclude: ['/admin'],
      cacheDir: '.coralite/cache'
    })
  ]
})
```

## Features

- **Concurrent Translation:** Processes pages and chunks in parallel, significantly speeding up translation tasks.
- **Concurrency Limit:** Global limit on concurrent API requests to respect OpenAI rate limits (default: 5).
- **Caching:** Caches translations to disk to avoid redundant API calls.
- **HTML Preservation:** Parses HTML and only translates text nodes, preserving structure and attributes.
- **Incremental:** Only re-translates when source content changes.
