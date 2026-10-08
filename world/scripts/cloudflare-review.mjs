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

run('npm',['--prefix','world','run','author:build'])
run('npm',['run','ci'])
stageEntryReview(root,world)
run('npm',['run','world:check'])
run('npm',['--prefix','world','run','author:check'])
prepareCloudflareBrowser(root)
const placements=read(path.join(world,'authoring/placements.json')).regions
const ids=(process.env.WORLD_REVIEW_REGIONS??process.argv.find(a=>a.startsWith('--regions='))?.slice(10)??Object.keys(placements).slice(0,3).join(',')).split(',')
if(ids.some(id=>!placements[id])||new Set(ids).size!==ids.length)throw Error('Invalid capture region selection')
fs.rmSync(path.join(world,'preview-shots'),{recursive:true,force:true})
if(ids.includes('lumbright'))run(process.execPath,['scripts/render-proc.mjs','dustpaw_rat','cave_goblin','--out','world/preview-shots/creatures'])
for(const id of ids)await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['world/scripts/review-authoring.mjs',id,'--prepared'],{cwd:root,stdio:['ignore','pipe','inherit']})
 const lines=createInterface({input:child.stdout})
 lines.on('line',line=>{if(!line.startsWith('AUTHORING_IMAGE '))console.log(line)})
 child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('World capture failed '+id+': '+code)))
})
const shots=path.join(world,'preview-shots')
const files=new Set(fs.readdirSync(shots,{recursive:true}).filter(f=>fs.statSync(path.join(shots,f)).isFile()))
const manifests=[],receipts={},reports={}
for(const id of ids){
 const report=read(path.join(world,'authoring/reports/'+id+'.json')),evidence=read(path.join(shots,id,'evidence.json'))
 const receiptFile=path.join(world,'authoring/reviews/'+id+'.json'),receipt=fs.existsSync(receiptFile)?read(receiptFile):null
 const manifest={...validateReviewEvidence({report,evidence,receipt,commit,files}),buildId:process.env.WORKERS_CI_BUILD_UUID??null,renderer:evidence.renderer,node:process.version,captureCount:evidence.captures.length}
 if(id==='lumbright'){
  const experience=read(path.join(shots,id,'experience.json')),seen=new Set(experience.captures.map(c=>c.id))
  if(experience.sourceHash!==report.sourceHash||experience.commit!==commit||seen.size!==EXPERIENCE_VIEWS.length||!EXPERIENCE_VIEWS.every(v=>seen.has(v.id)))throw Error('Incomplete or stale experience coverage')
  for(const c of experience.captures){const mobile=c.id.startsWith('mobile:');if(c.viewport.width!==(mobile?390:1280)||c.viewport.height!==(mobile?844:800)||!files.has(id+'/'+c.file))throw Error('Invalid experience '+c.id)}
  manifest.experienceCaptureCount=seen.size;manifest.experienceViews=[...seen]
  if(manifest.approval==='approved'&&!EXPERIENCE_VIEWS.every(v=>receipt.experienceViews?.includes(v.id)))manifest.approval='pending'
 }
 manifests.push(manifest);receipts[id]=receipt;reports[id]=report
}
const out=path.join(world,'review-site'),destination=path.join(out,commit)
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(destination,{recursive:true})
fs.cpSync(shots,destination,{recursive:true})
fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({schemaVersion:1,commit,regions:manifests},null,2)+'\n')
for(const id of ids){
 fs.copyFileSync(path.join(world,'authoring/reports/'+id+'.json'),path.join(destination,id,'report.json'))
 fs.writeFileSync(path.join(destination,id,'receipt.json'),JSON.stringify(receipts[id],null,2)+'\n')
}
for(const relative of ['zones/overworld.json','authoring/assets.generated.json',...Object.keys(placements).map(id=>'zones/'+id+'.json'),...Object.keys(placements).map(id=>'authoring/reports/'+id+'.json')]){
 const target=path.join(destination,'generated',relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(world,relative),target)
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const cards=[]
for(const id of ids){
 const evidence=read(path.join(shots,id,'evidence.json'))
 const experience=id==='lumbright'?read(path.join(shots,id,'experience.json')).captures:[]
 cards.push('<section><h2>'+escape(id)+'</h2><p>Visual approval: '+escape(manifests.find(m=>m.region===id).approval)+' · <a href="'+id+'/report.json">Semantic contract and gaps</a></p><div class="grid">'+[...evidence.captures,...experience].map(c=>'<article><h3>'+escape(c.id)+'</h3><a href="'+id+'/'+escape(c.file)+'"><img loading="lazy" src="'+id+'/'+escape(c.file.replace('.png','.jpg'))+'" alt="'+escape(c.id)+'"></a><p>'+c.viewport.width+' × '+c.viewport.height+' · <a href="'+id+'/'+escape(c.file)+'">Native PNG</a></p></article>').join('')+'</div></section>')
}
for(const creature of ids.includes('lumbright')?['dustpaw_rat','cave_goblin']:[])cards.push('<section><h2>'+escape(creature)+' states</h2><div class="grid">'+(creature==='cave_goblin'?['idle','attack','hit','death','walk']:['idle','attack','hit','death']).map(s=>'<article><h3>'+s+'</h3><a href="creatures/'+creature+'-'+s+'.png"><img src="creatures/'+creature+'-'+s+'.png"></a></article>').join('')+'</div></section>')
const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Eldermoor semantic review</title><style>body{margin:0;background:#191c1b;color:#e9e3d6;font:16px/1.55 system-ui}main{max-width:1500px;padding:24px;margin:auto}a{color:#d5bf83}code{overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{background:#252b27;padding:14px;border-radius:8px}img{display:block;width:100%;height:240px;object-fit:contain;background:#171a17}h3{font-size:16px}</style><main><h1>Eldermoor semantic world review</h1><p>Source commit <code>'+commit+'</code>. Auth-free software scene review; device performance and live multiplayer need separate checks.</p><p><a href="manifest.json">Coverage manifest</a></p>'+cards.join('')+'</main></html>'
fs.writeFileSync(path.join(destination,'index.html'),html)
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Eldermoor review</title><a href="./'+commit+'/">Open semantic world review</a>')
console.log('CLOUDFLARE_WORLD_REVIEW '+JSON.stringify({commit,regions:manifests.map(m=>({region:m.region,sourceHash:m.sourceHash,captures:m.captureCount,approval:m.approval}))}))
