import { build } from 'esbuild'
import { mkdirSync, copyFileSync, writeFileSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'
const out=resolve(process.argv[2]||'.tmp/skill-motion-review')
mkdirSync(out,{recursive:true})
await build({entryPoints:['scripts/skill-motion/review.jsx'],outfile:out+'/review.js',bundle:true,minify:true,format:'esm',jsx:'automatic',jsxImportSource:'preact'})
copyFileSync('.tmp/app.css',out+'/app.css')
copyFileSync('scripts/skill-motion/review.css',out+'/review.css')
cpSync('scripts/skill-motion/baseline',out+'/baseline',{recursive:true})
copyFileSync('scripts/skill-motion/references.html',out+'/references.html')
writeFileSync(out+'/index.html','<!doctype html><html lang="en" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PocketRPG · All skill motions</title><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="review.css"><body><div id="app"></div><script type="module" src="review.js"></script></body></html>')
console.log(out)
