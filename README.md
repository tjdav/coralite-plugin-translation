
# Coralite plugin translation

A powerful translation plugin for Coralite that uses the OpenAI API to automatically translate your static site's page content. It parses your HTML, intelligently translates text nodes while preserving structure, and caches the results locally.

## Features

- **Concurrent Processing:** Translates pages and chunks in parallel, drastically reducing build times. Includes a configurable global limit on concurrent API requests to respect OpenAI rate limits.
- **Smart Caching:** Caches translations to `.coralite/translations` by default to avoid redundant API calls. It only re-translates when the source content changes and automatically cleans up unused translations after a successful build.
- **Strict HTML Preservation & Validation:** Parses HTML into an AST and strictly translates only text nodes. It validates the LLM's output by checking tag parity, attribute preservation, and text length ratios (including CJK character adjustments) to prevent AI hallucinations.
- **Code Block Intelligence:** Detects `<pre>` and `<code>` blocks and uses a specialized prompt to translate *only* comments and user-facing string literals, preserving your code's exact functionality.
- **Link Localization:** Automatically updates relative internal links to point to the correct localized version (e.g., updating `href="/about.html"` to `href="/fr/about.html"`).
- **Attribute Translation:** Intelligently parses and translates specific HTML attributes, including `alt`, `title`, `placeholder`, and `aria-label`.

## Installation

```bash
pnpm add coralite-plugin-translation

```

*(Note: Requires Node.js and a compatible version of Coralite).*

## Usage

```javascript
import { Coralite } from 'coralite'
import translation from 'coralite-plugin-translation'

const coralite = new Coralite({
  pages: './pages',
  templates: './templates',
  plugins: [
    translation({
      sourceLanguage: 'en',
      targetLanguages: ['de', 'fr', 'es'],
      concurrency: 5,
      api: {
        key: process.env.OPENAI_API_KEY,
        model: 'gpt-4o',
        temperature: 0.1 // Optional: lower temperature for more deterministic translations
      },
      exclude: ['/admin', '/private'],
      cacheDir: '.coralite/translations'
    })
  ]
})

```

## Configuration Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `sourceLanguage` | `string` | **Required** | The source language code of your original content (e.g., `'en'`). |
| `targetLanguages` | `string[]` | **Required** | An array of target language codes to translate to (e.g., `['de', 'fr', 'es']`). |
| `api` | `object` | `{}` | OpenAI API configuration (see below for nested parameters). |
| `concurrency` | `number` | `4` | Maximum number of concurrent API requests. |
| `exclude` | `string[]` | `[]` | Array of path patterns to exclude from translation. |
| `cacheDir` | `string` | `'.coralite/translations'` | Directory to store translation cache files. |
| `chunkSize` | `number` | `10` | Number of HTML blocks/text nodes to process per API request. |
| `retries` | `number` | `3` | Number of retry attempts for failed API calls. |
| `maxTokensMultiplier` | `number` | `1000` | Multiplier for `max_tokens` calculation based on your `chunkSize`. |

### `api` Object Parameters

The `api` object configures your connection to the LLM. It accepts the following OpenAI-specific parameters:

* `key` (string): Your OpenAI API key. **Required if not using a local proxy.**
* `baseURL` (string): Custom API base URL (default: `'https://api.openai.com/v1'`). Useful for proxying or using OpenAI-compatible APIs like Ollama or LM Studio.
* `model` (string): The model to use (default: `'gpt-3.5-turbo'`).
* `temperature` (number): Sampling temperature.
* `top_p` (number): Nucleus sampling probability.
* `frequency_penalty` (number): Frequency penalty.
* `presence_penalty` (number): Presence penalty.

## Contributing

We welcome contributions! The plugin is built with Node.js and uses `pnpm` for package management.

1. Clone the repository and install dependencies:
```bash
pnpm install

```


2. Run the test suite (powered by `node:test` and `node:assert`):
```bash
pnpm test

```


3. Lint your code before submitting a Pull Request:
```bash
pnpm lint

```