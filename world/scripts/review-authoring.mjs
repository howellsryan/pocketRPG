#!/usr/bin/env node
// Deterministic review views, full PNG artifacts, and small contact sheets.
// Scene screenshots are visual evidence, not real-device frame-rate proof.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import sharp from 'sharp'

const worldDir=fileURLToPath(new URL('..',import.meta.url))
const id=process.argv[2]??'lumbright'
if(!/^[a-z][a-z0-9_]*$/.test(id))throw new Error('Invalid region id')
// Standalone reviews must not label stale dist with a fresh source hash.
execFileSync(process.execPath,[path.join(worldDir,'scripts/compile-world.mjs'),id,'--check'],{cwd:worldDir,stdio:'inherit'})
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{cwd:worldDir,stdio:'inherit'})
const report=JSON.parse(fs.readFileSync(path.join(worldDir,'authoring/reports',id+'.json'),'utf8'))
const zone=JSON.parse(fs.readFileSync(path.join(worldDir,'zones',id+'.json'),'utf8'))
const overworld=JSON.parse(fs.readFileSync(path.join(worldDir,'zones/overworld.json'),'utf8'))
const landmark=overworld.landmarks.find((p)=>p.id===zone.id)
if(!landmark)throw new Error('Region not stamped into overworld')
const offset={x:landmark.x-zone.spawn.x,z:landmark.z-zone.spawn.z}
const out=path.join(worldDir,'preview-shots',id)
fs.mkdirSync(out,{recursive:true})
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--config','client/vite.config.ts','--port','4174','--host','127.0.0.1'],{cwd:worldDir,stdio:'inherit'})
const emit=async(name,buffer)=>{
  fs.writeFileSync(path.join(out,name+'.jpg'),buffer)
  const b64=buffer.toString('base64')
  for(let i=0;i<b64.length;i+=3000)console.log('AUTHORING_IMAGE '+name+' '+i+' '+b64.slice(i,i+3000))
}
async function sheet(name,shots,columns,tw,th) {
  const composites=[]
  const rows=Math.ceil(shots.length/columns)
  for(const [i,shot] of shots.entries()) {
    const thumb=await sharp(path.join(out,shot.file)).resize(tw,th,{fit:'contain',background:'#29251d'}).png().toBuffer()
    const title=Buffer.from('<svg width="'+tw+'" height="28"><rect width="100%" height="100%" fill="#29251d"/><text x="8" y="20" fill="#eadcba" font-family="sans-serif" font-size="15">'+shot.id+'</text></svg>')
    const left=(i%columns)*tw,top=Math.floor(i/columns)*(th+28)
    composites.push({input:thumb,left,top:top+28},{input:title,left,top})
  }
  const buffer=await sharp({create:{width:columns*tw,height:rows*(th+28),channels:3,background:'#29251d'}}).composite(composites).jpeg({quality:78}).toBuffer()
  await emit(name,buffer)
}

const captures=[]
const creatureDir=path.join(worldDir,'preview-shots/creatures')
if(fs.existsSync(creatureDir)) {
  const shots=fs.readdirSync(creatureDir).filter((f)=>f.startsWith('dustpaw_rat-')&&f.endsWith('.png')).sort()
  const composites=[]
  for(const [i,file] of shots.entries()){
    const thumb=await sharp(path.join(creatureDir,file)).resize(480,373).png().toBuffer()
    composites.push({input:thumb,left:(i%2)*480,top:Math.floor(i/2)*373})
  }
  await emit('rat',await sharp({create:{width:960,height:746,channels:3,background:'#eee2c8'}}).composite(composites).jpeg({quality:85}).toBuffer())
}
let browser
try {
  const origin='http://127.0.0.1:4174'
  let available=false
  for(let i=0;i<100;i++) {
    try { if((await fetch(origin+'/world/preview.html')).ok){available=true;break} } catch {}
    await new Promise((resolve)=>setTimeout(resolve,150))
  }
  if(!available)throw new Error('Preview server did not start')
  browser=await chromium.launch({args:['--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  for(const view of report.reviewViews) {
    const variants=view.mode==='overview'?['desktop']:['desktop','mobile','integrated']
    for(const variant of variants) {
      const mobile=variant==='mobile',integrated=variant==='integrated'
      const viewport=mobile?{width:390,height:844}:{width:1280,height:800}
      const page=await browser.newPage({viewport,deviceScaleFactor:1})
      const errors=[]
      page.on('pageerror',(error)=>errors.push(error.message))
      page.on('console',(message)=>{if(message.type()==='error')errors.push(message.text())})
      page.on('response',(response)=>{if(response.status()>=400)errors.push(response.status()+' '+response.url())})
      page.on('requestfailed',(request)=>errors.push('Failed '+request.url()))
      const params=new URLSearchParams({
        zone:integrated?'overworld':id,mode:view.mode,snapshot:'1',
        target:(view.x+(integrated?offset.x:0))+','+(view.z+(integrated?offset.z:0)),
        yaw:String(view.yaw??0),zoom:String(view.zoom??1.3),pitch:String(view.pitch??.8),
        ...(view.distance?{distance:String(view.distance)}:{}),
      })
      const url=origin+'/world/preview.html?'+params
      await page.goto(url)
      await page.waitForFunction(()=>window.__previewReady||window.__previewError,null,{timeout:60000})
      await page.waitForTimeout(300)
      const state=await page.evaluate(()=>({ready:window.__previewReady,error:window.__previewError,stats:window.__previewStats}))
      if(!state.ready||state.error)throw new Error('Scene setup failed: '+state.error)
      if(errors.length)throw new Error('Render errors in '+variant+':'+view.id+': '+errors.join('; '))
      const name=variant+'-'+view.id+'.png'
      await page.screenshot({path:path.join(out,name),timeout:60000})
      captures.push({id:variant+':'+view.id,file:name,viewport,stats:state.stats,url:url.replace(origin,'')})
      await emit(variant+'-'+view.id,await sharp(path.join(out,name)).jpeg({quality:85}).toBuffer())
      await page.close()
    }
  }
  const evidence={schemaVersion:1,region:id,sourceHash:report.sourceHash,commit:process.env.GITHUB_SHA??null,
    renderer:'Chromium SwiftShader (software); not a mobile device benchmark',captures,visualApproval:'pending'}
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n')
  console.log('AUTHORING_EVIDENCE '+JSON.stringify(evidence))
  await sheet('desktop',captures.filter((s)=>s.id.startsWith('desktop:')),3,480,300)
  await sheet('mobile',captures.filter((s)=>s.id.startsWith('mobile:')),3,260,562)
  await sheet('integrated',captures.filter((s)=>s.id.startsWith('integrated:')),3,480,300)

} catch (error) {
  fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({sourceHash:report.sourceHash,captures,error:String(error)},null,2)+'\n')
  for(const variant of ['desktop','mobile','integrated']) {
    const partial=captures.filter((s)=>s.id.startsWith(variant+':'))
    if(partial.length)await sheet('partial-'+variant,partial,3,variant==='mobile'?260:480,variant==='mobile'?562:300)
  }
  throw error
} finally {await browser?.close();server.kill('SIGTERM')}
