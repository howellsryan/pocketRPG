#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { GATHER_TASKS } from '../../src/engine/gatherTasks.js'
import {EXPERIENCE_VIEWS} from '../authoring/experience-views.mjs'
import { compileRegion } from '../authoring/compiler.mjs'
import { measureAuthoringAssets } from './authoring-assets.mjs'

const worldDir=fileURLToPath(new URL('..',import.meta.url))
const root=path.join(worldDir,'..')
const args=process.argv.slice(2)
const selected=args.find(a=>!a.startsWith('--'))
if(selected&&!/^[a-z][a-z0-9_]*$/.test(selected))throw new Error('Invalid region id')
const read=(file)=>JSON.parse(fs.readFileSync(file,'utf8'))
const placements=read(path.join(worldDir,'authoring/placements.json'))
const sources=Object.fromEntries(Object.keys(placements.regions).map(id=>[id,read(path.join(worldDir,'authoring/regions',id+'.json'))]))
if(selected&&!sources[selected])throw Error('Unknown authored region '+selected)
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
const sceneFiles=["world/client/src/graphics.ts","world/scripts/stage-entry-review.mjs","src/index.css","world/client/src/main.ts","src/components/WorldEntryButton.jsx","world/authoring/experience-views.mjs","src/components/WorldEntryCard.jsx","world/client/vite.config.ts","world/client/src/exits.ts","world/client/src/worldMap.ts","world/client/src/ui.ts","world/shared/protocol.ts","world/authoring/compiler.mjs","world/client/src/preview/main.ts","world/scripts/review-authoring.mjs","world/client/src/props.ts","world/client/src/statics.ts","world/client/src/entities.ts","world/client/src/terrain.ts","world/client/src/terrainMaterials.ts","world/client/src/chunkedTerrain.ts","world/client/src/assetBase.ts","world/client/src/motion.ts","world/client/src/groundPaint.ts","world/client/src/paintGeometry.ts","world/shared/groundKinds.ts","world/shared/resources.ts","world/authoring/integrate.mjs","world/client/src/minimap.ts","world/client/src/itemIcon.ts","world/client/src/scene.ts","world/client/src/ambient.ts","world/client/src/scatter.ts","world/client/src/procCreature.ts","world/shared/monsterModels.ts","world/shared/ambientModels.ts","world/shared/propScale.js","world/scripts/gen-overworld.mjs","world/scripts/overworldLayout.mjs","src/data/creatures3d.json","src/3d/blendShell.js","src/3d/rigs.js","src/data/items.json","world/shared/mapCategories.ts","src/data/bespokeIcons.json","src/data/gameIcons.json","src/data/gameIconsManifest.json","src/utils/itemIconResolve.js","src/utils/iconTints.js","src/components/GameIcon.jsx","src/3d/biomes.js","src/3d/creatures.js","src/3d/heroAttach.js","src/3d/heroCompose.js","src/3d/heroCreature.js"]
const entryAssets=Object.fromEntries(['public/forge/iron.webp','public/forge/parchment.webp','package-lock.json'].map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]))
const instanceZones=Object.fromEntries(['grondar_lair','cow_pasture','fiend_pit','dragon_roost','zaryth_throne'].map(zoneId=>[zoneId,read(path.join(worldDir,'zones',zoneId+'.json'))]))
context.instanceZones=instanceZones
const inputs={sources,placements,wilderness:read(path.join(worldDir,'authoring/wilderness.json')),prefabs,policy,context,entryAssets,instanceZones,scene:Object.fromEntries(sceneFiles.map(p=>[p,fs.readFileSync(path.join(root,p),'utf8')]))}
const serial=v=>JSON.stringify(v,null,1)+'\n'
const outputs={'authoring/assets.generated.json':serial(assets)},reports={}
for(const [id,source]of Object.entries(sources)){
 const {zone,report}=compileRegion(source,context)
 report.sourceHash=createHash('sha256').update(JSON.stringify({...inputs,region:id})).digest('hex')
 reports[id]=report
 outputs['zones/'+id+'.json']=serial(zone)
 outputs['authoring/reports/'+id+'.json']=serial(report)
}
for(const [relative,content]of Object.entries(outputs)){
 const file=path.join(worldDir,relative)
 if(args.includes('--check')){
  if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==content)throw Error('Generated file drift: '+relative+'; run npm run author:build')
 }else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content)}
}
execFileSync(process.execPath,[path.join(worldDir,'scripts/gen-overworld.mjs'),...(args.includes('--check')?['--check']:[])],{cwd:worldDir,stdio:'inherit'})
for(const report of Object.values(reports))console.log('AUTHORING_SUMMARY '+JSON.stringify({region:report.region,sourceHash:report.sourceHash,counts:report.counts,parity:report.parity,visualApproval:report.visualApproval}))
if(args.includes('--emit')) {
  outputs['zones/overworld.json']=fs.readFileSync(path.join(worldDir,'zones/overworld.json'),'utf8')
  const encoded=Buffer.from(JSON.stringify(outputs)).toString('base64')
  for(let i=0;i<encoded.length;i+=3000)console.log('AUTHORING_FILES '+i+' '+encoded.slice(i,i+3000))
}
if(args.includes('--release'))for(const [id,report]of Object.entries(reports)) {
  const receipt=read(path.join(worldDir,'authoring/reviews',id+'.json'))
  if(receipt.region!==id || receipt.sourceHash!==report.sourceHash || receipt.verdict!=='approved' || !receipt.reviewedBy || !receipt.evidenceUrl)throw new Error('Current-source visual review approval is required')
  const required=report.reviewViews.flatMap((v)=>v.mode==='overview' ? ['desktop:'+v.id] : ['desktop:'+v.id,'mobile:'+v.id,'integrated:'+v.id])
  for(const view of required)if(!receipt.views?.includes(view))throw new Error('Unreviewed view '+view)
  for(const view of id==='lumbright'?EXPERIENCE_VIEWS:[])if(!receipt.experienceViews?.includes(view.id))throw new Error('Unreviewed experience '+view.id)
}
