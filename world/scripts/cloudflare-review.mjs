#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn,execFileSync} from 'node:child_process'
import {createInterface} from 'node:readline'
import {EXPERIENCE_VIEWS} from '../authoring/experience-views.mjs'
import {stageEntryReview} from './stage-entry-review.mjs'
import {prepareCloudflareBrowser} from './cloudflare-browser.mjs'
import {validateReviewEvidence} from '../authoring/review-evidence.mjs'

const root=fileURLToPath(new URL('../..',import.meta.url))
const world=path.join(root,'world')
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'))
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:root,stdio:'inherit'})
const commit=process.env.WORKERS_CI_COMMIT_SHA??execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Missing source commit')
process.env.GITHUB_SHA=commit
run('python3',['tools/agent-skills.py'])
run('python3',['tools/agent-skills.py','--check'])
run(process.execPath,['--test','world/authoring/review-evidence.test.mjs'])
run('npm',['--prefix','world','ci','--no-audit','--no-fund'])
run('npm',['run','ci'])
run('npm',['run','world:check'])
run('npm',['--prefix','world','run','author:check'])
stageEntryReview(root,world)
prepareCloudflareBrowser(root)
fs.rmSync(path.join(world,'preview-shots'),{recursive:true,force:true})
run(process.execPath,['scripts/render-proc.mjs','dustpaw_rat','--out','world/preview-shots/creatures'])
// Keep image binaries in static evidence instead of megabytes of base64 build logs.
await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['world/scripts/review-authoring.mjs','lumbright'],{cwd:root,stdio:['ignore','pipe','inherit']})
  const lines=createInterface({input:child.stdout})
  lines.on('line',line=>{if(!line.startsWith('AUTHORING_IMAGE '))console.log(line)})
  child.on('error',reject)
  child.on('close',code=>code===0?resolve():reject(new Error('World capture failed: '+code)))
})
const shots=path.join(world,'preview-shots')
const report=read(path.join(world,'authoring/reports/lumbright.json'))
const experience=read(path.join(shots,'lumbright/experience.json'))
const evidence=read(path.join(shots,'lumbright/evidence.json'))
const receiptFile=path.join(world,'authoring/reviews/lumbright.json')
const receipt=fs.existsSync(receiptFile)?read(receiptFile):null
const files=new Set(fs.readdirSync(shots,{recursive:true}).filter(f=>fs.statSync(path.join(shots,f)).isFile()))
const experienceIds=new Set(experience.captures.map(c=>c.id))
if(experience.sourceHash!==report.sourceHash||experience.commit!==commit||experienceIds.size!==EXPERIENCE_VIEWS.length||!EXPERIENCE_VIEWS.every(v=>experienceIds.has(v.id)))throw new Error('Incomplete or stale experience capture coverage')
for(const capture of experience.captures) {
 const mobile=capture.id.startsWith('mobile:')
 if(capture.viewport.width!==(mobile?390:1280)||capture.viewport.height!==(mobile?844:800)||!files.has('lumbright/'+capture.file))throw new Error('Invalid experience capture '+capture.id)
}
const manifest={...validateReviewEvidence({report,evidence,receipt,commit,files}),buildId:process.env.WORKERS_CI_BUILD_UUID??null,renderer:evidence.renderer,node:process.version,captureCount:evidence.captures.length,experienceCaptureCount:experience.captures.length,experienceViews:[...experienceIds]}
if(manifest.approval==='approved'&&!EXPERIENCE_VIEWS.every(v=>receipt.experienceViews?.includes(v.id))){manifest.approval='pending';manifest.scope='Awaiting current-source experience review approval'}
const out=path.join(world,'review-site')
fs.rmSync(out,{recursive:true,force:true})
const destination=path.join(out,commit)
fs.mkdirSync(destination,{recursive:true})
fs.cpSync(shots,destination,{recursive:true})
for(const [file,value] of Object.entries({'manifest.json':manifest,'receipt.json':receipt}))fs.writeFileSync(path.join(destination,file),JSON.stringify(value,null,2)+'\n')
// Preserve the compiler's exact generated serialization for downstream freshness checks.
fs.copyFileSync(path.join(world,'authoring/reports/lumbright.json'),path.join(destination,'report.json'))
for(const relative of ['zones/lumbright.json','zones/overworld.json','zones/grondar_lair.json','zones/cow_pasture.json','zones/fiend_pit.json','zones/dragon_roost.json','zones/zaryth_throne.json','authoring/assets.generated.json'])fs.copyFileSync(path.join(world,relative),path.join(destination,path.basename(relative)))
fs.copyFileSync(path.join(root,'functions/_lib/chat/knowledge.js'),path.join(destination,'knowledge.js'))
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const cards=evidence.captures.map(c=>'<article><h3>'+escape(c.id)+'</h3><a href="lumbright/'+escape(c.file)+'"><img loading="lazy" src="lumbright/'+escape(c.file.replace('.png','.jpg'))+'" alt="'+escape(c.id)+'"></a><p>'+c.viewport.width+' × '+c.viewport.height+' · <a href="lumbright/'+escape(c.file)+'">Full PNG</a></p></article>').join('')
const experienceCards=experience.captures.map(c=>'<article><h3>'+escape(c.id)+'</h3><a href="lumbright/'+escape(c.file)+'"><img loading="lazy" src="lumbright/'+escape(c.file.replace('.png','.jpg'))+'" alt="'+escape(c.id)+'"></a><p>'+c.viewport.width+' × '+c.viewport.height+' · Auth-free component and scene review</p></article>').join('')
const rat=['idle','attack','hit','death'].map(state=>'<article><h3>Rat '+state+'</h3><a href="creatures/dustpaw_rat-'+state+'.png"><img loading="lazy" src="creatures/dustpaw_rat-'+state+'.png" alt="Rat '+state+'"></a></article>').join('')
const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Lumbright world review</title><style>body{margin:0;background:#191c1b;color:#e9e3d6;font:16px/1.55 system-ui}main{max-width:1500px;padding:24px;margin:auto}a{color:#d5bf83}h1,h2,h3{line-height:1.2}code{overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{background:#252b27;padding:14px;border-radius:8px}img{display:block;width:100%;height:240px;object-fit:contain;background:#171a17}h3{font-size:16px}header{border-bottom:1px solid #485148;padding-bottom:20px;margin-bottom:24px}.status{font-weight:bold;color:#e8c46f}</style><main><header><h1>Lumbright world review</h1><p class="status">Visual approval: '+escape(manifest.approval)+'</p><p>'+escape(manifest.scope)+'</p><p>Source commit: <code>'+commit+'</code><br>Source fingerprint: <code>'+report.sourceHash+'</code></p><p>'+manifest.captureCount+' world views plus four rat combat states. Software rendering; phone performance and live gameplay remain separate checks.</p><p><a href="manifest.json">Manifest</a> · <a href="lumbright/evidence.json">Capture evidence</a> · <a href="report.json">Semantic audit</a> · <a href="receipt.json">Review receipt</a> · <a href="lumbright.json">Lumbright map</a> · <a href="overworld.json">Integrated map</a></p><p><a href="lumbright/desktop.jpg">Desktop contact sheet</a> · <a href="lumbright/mobile.jpg">Portrait contact sheet</a> · <a href="lumbright/integrated.jpg">Integrated contact sheet</a> · <a href="lumbright/rat.jpg">Rat contact sheet</a></p></header><h2>World composition</h2><div class="grid">'+cards+'</div><h2>Travel and entry experience</h2><p>'+escape(experience.scope)+'</p><div class="grid">'+experienceCards+'</div><h2>Rat states</h2><div class="grid">'+rat+'</div></main></html>'
fs.writeFileSync(path.join(destination,'index.html'),html)
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>PocketRPG world review</title><h1>PocketRPG world review</h1><p><a href="./'+commit+'/">Open the latest Lumbright review</a></p><p>Commit '+commit+' · Visual approval '+manifest.approval+'</p></html>')
fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n')
fs.writeFileSync(path.join(out,'_headers'),'/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n')
console.log('CLOUDFLARE_WORLD_REVIEW '+JSON.stringify(manifest))
