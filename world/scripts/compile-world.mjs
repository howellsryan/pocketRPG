#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { GATHER_TASKS } from '../../src/engine/gatherTasks.js'
import { compileRegion } from '../authoring/compiler.mjs'
import { measureAuthoringAssets } from './authoring-assets.mjs'

const worldDir=fileURLToPath(new URL('..',import.meta.url))
const root=path.join(worldDir,'..')
const args=process.argv.slice(2)
const id=args.find((a)=>!a.startsWith('--'))??'lumbright'
if(!/^[a-z][a-z0-9_]*$/.test(id))throw new Error('Invalid region id')
const read=(file)=>JSON.parse(fs.readFileSync(file,'utf8'))
const source=read(path.join(worldDir,'authoring/regions',id+'.json'))
const prefabs=read(path.join(worldDir,'authoring/prefabs.json'))
const policy=read(path.join(worldDir,'authoring/asset-policy.json'))
const assets=await measureAuthoringAssets(policy)
const context={
  world:read(path.join(root,'src/data/world.json')),
  activities:read(path.join(root,'src/data/worldActivities.json')),
  skills:read(path.join(root,'src/data/skills.json')),
  monsters:read(path.join(root,'src/data/monsters.json')),
  gatherTasks:GATHER_TASKS,assets,prefabs:prefabs.prefabs,
}
const {zone,report}=compileRegion(source,context)
const sceneFiles=['world/authoring/compiler.mjs','world/client/src/preview/main.ts','world/scripts/review-authoring.mjs','world/client/src/props.ts','world/client/src/statics.ts','world/client/src/entities.ts','world/client/src/terrain.ts','world/client/src/terrainMaterials.ts','world/client/src/chunkedTerrain.ts','world/client/src/assetBase.ts','world/client/src/motion.ts','world/client/src/groundPaint.ts','world/client/src/paintGeometry.ts','world/shared/groundKinds.ts','world/client/src/scene.ts','world/client/src/ambient.ts','world/client/src/scatter.ts','world/client/src/procCreature.ts','world/shared/monsterModels.ts','world/shared/ambientModels.ts','world/shared/propScale.js','world/scripts/gen-overworld.mjs','src/data/creatures3d.json','src/3d/blendShell.js','src/3d/rigs.js','src/data/items.json']
const inputs={source,prefabs,policy,context,scene: Object.fromEntries(sceneFiles.map((p)=>[p,fs.readFileSync(path.join(root,p),'utf8')]))}
report.sourceHash=createHash('sha256').update(JSON.stringify(inputs)).digest('hex')
const serial=(v)=>JSON.stringify(v,null,1)+'\n'
const outputs={
  ['zones/'+id+'.json']:serial(zone),
  ['authoring/reports/'+id+'.json']:serial(report),
  'authoring/assets.generated.json':serial(assets),
}
for(const [relative,content] of Object.entries(outputs)) {
  const file=path.join(worldDir,relative)
  if(args.includes('--check')) {
    if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==content)throw new Error('Generated file drift: '+relative+'; run npm run author:build')
  } else {
    fs.mkdirSync(path.dirname(file),{recursive:true})
    fs.writeFileSync(file,content)
  }
}
execFileSync(process.execPath,[path.join(worldDir,'scripts/gen-overworld.mjs'),...(args.includes('--check')?['--check']:[])],{cwd:worldDir,stdio:'inherit'})
console.log('AUTHORING_SUMMARY '+JSON.stringify({sourceHash:report.sourceHash,counts:report.counts,parity:report.parity,visualApproval:report.visualApproval}))
if(args.includes('--emit')) {
  outputs['zones/overworld.json']=fs.readFileSync(path.join(worldDir,'zones/overworld.json'),'utf8')
  const encoded=Buffer.from(JSON.stringify(outputs)).toString('base64')
  for(let i=0;i<encoded.length;i+=3000)console.log('AUTHORING_FILES '+i+' '+encoded.slice(i,i+3000))
}
if(args.includes('--release')) {
  const receipt=read(path.join(worldDir,'authoring/reviews',id+'.json'))
  if(receipt.sourceHash!==report.sourceHash || receipt.verdict!=='approved' || !receipt.reviewedBy || !receipt.evidenceUrl)throw new Error('Current-source visual review approval is required')
  const required=report.reviewViews.flatMap((v)=>v.mode==='overview' ? ['desktop:'+v.id] : ['desktop:'+v.id,'mobile:'+v.id,'integrated:'+v.id])
  for(const view of required)if(!receipt.views?.includes(view))throw new Error('Unreviewed view '+view)
}
