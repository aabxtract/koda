#!/usr/bin/env node
import { main } from '../cli/index.js'

main(process.argv).catch(error => {
  console.error(`Koda: ${error.message}`)
  process.exitCode = 1
})
