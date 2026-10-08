import fs from 'node:fs'
import path from 'node:path'

/** Use the actual built idle CSS, fonts and textures in the component review. */
export function stageEntryReview(root,world) {
  const raw=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n')
  if(!raw)throw new Error('Built idle stylesheet missing')
  const refs=[...raw.matchAll(/url\(["']?((?:\.\/|\/)?public\/[^)"']+)["']?\)/g)].map(match=>match[1])
  for(const ref of new Set(refs)){
    const relative=ref.replace(/^(?:\.\/|\/)?public\//,'')
    if(relative.split('/').includes('..'))throw new Error('Invalid review asset path')
    const source=path.join(root,'public',relative),target=path.join(world,'client/public/entry-assets',relative)
    if(!fs.existsSync(source))throw new Error('Missing built idle review asset '+relative)
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target)
  }
  const css=raw.replace(/(["'(])(?:\.\/|\/)?public\//g,'$1/world/entry-assets/')
  fs.writeFileSync(path.join(world,'client/public/entry-review.css'),css)
}
