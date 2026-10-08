#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveContract } from '../authoring/compiler.mjs'
import { GATHER_TASKS } from '../../src/engine/gatherTasks.js'
const root=fileURLToPath(new URL('../..',import.meta.url))
const read=(name)=>JSON.parse(fs.readFileSync(path.join(root,'src/data',name+'.json'),'utf8'))
const place=process.argv[2]??'lumbright'
const world=read('world'),activities=read('worldActivities'),skills=read('skills'),items=read('items')
const contract=deriveContract(place,{world,activities})
const resources=contract.resources.map((ref)=>{
  const parts=ref.split(':')
  const definition=parts[0]==='gather'?GATHER_TASKS.find((t)=>t.id===parts[1]):skills[parts[1]]?.actions.find((a)=>a.id===parts[2])
  return {ref,definition,stackable:definition?.product?Boolean(items[definition.product]?.stackable):undefined}
})
console.log(JSON.stringify({place,lore:world.places[place].lore,contract,resources},null,2))
