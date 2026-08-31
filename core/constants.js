import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Single source of truth: package.json — no more version rot.
export const KODA_VERSION = require('../package.json').version
export const MEMORY_SCHEMA = 1
export const REPORT_SCHEMA = 1
