import {afterEach, describe, expect, it} from 'vitest'
import {createRequire} from 'node:module'
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve, join} from 'node:path'
import {execFileSync} from 'node:child_process'
const {resolveWorldBuildFlags} = createRequire(import.meta.url)('../scripts/world-build-flags.cjs')
const roots: string[] = []
afterEach(() => {for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true})})
describe('world build availability', () => {
  it.each([{}, {WORKERS_CI_BRANCH:'main'}, {WORKERS_CI_BRANCH:'world/semantic-lumbright'}, {WORKERS_CI_BRANCH:'main',EnableWorldBeta:'true'}, {POCKETRPG_BUILD_ENV:'production',EnableWorldBeta:'true'}, {POCKETRPG_BUILD_ENV:'preview'}, {POCKETRPG_BUILD_ENV:'preview',EnableWorldBeta:'false'}])('does not expose world assets or entry through an ordinary build %j', env => {
    expect(resolveWorldBuildFlags(env)).toEqual({worldBetaEnabled:false,worldLairsEnabled:false})
  })
  it('enables explicitly opted-in preview even when its source branch is main', () => {
    expect(resolveWorldBuildFlags({WORKERS_CI_BRANCH:'main',POCKETRPG_BUILD_ENV:'preview',EnableWorldBeta:'true'})).toEqual({worldBetaEnabled:true,worldLairsEnabled:true})
  })
  it('retains preview boss-lair opt-out', () => {
    expect(resolveWorldBuildFlags({POCKETRPG_BUILD_ENV:'preview',EnableWorldBeta:'true',EnableWorldLairs:'false'})).toEqual({worldBetaEnabled:true,worldLairsEnabled:false})
  })
})
describe('staged world assets', () => {
  function fixture() {
    const root=mkdtempSync(join(tmpdir(),'pocket-world-stage-'))
    roots.push(root)
    for(const dir of ['scripts','public','guide','world/client/dist/assets'])mkdirSync(join(root,dir),{recursive:true})
    for(const name of ['index.html','robots.txt','sitemap.xml','manifest.json','hosted.html','_headers','game-abc123.js','public/idle.png','guide/index.html','world/client/dist/index.html','world/client/dist/assets/world.js'])writeFileSync(join(root,name),'fixture')
    for(const name of ['stage-site.mjs','world-build-flags.cjs'])copyFileSync(resolve(__dirname,'../scripts',name),join(root,'scripts',name))
    return root
  }
  function stage(root:string,env:Record<string,string>) {
    const isolated={...process.env,POCKETRPG_BUILD_ENV:'',EnableWorldBeta:'',EnableWorldLairs:'',...env}
    execFileSync(process.execPath,[join(root,'scripts/stage-site.mjs')],{env:isolated,stdio:'pipe'})
  }
  it('omits world HTML and JavaScript despite stale opt-in on a main build', () => {
    const root=fixture()
    stage(root,{WORKERS_CI_BRANCH:'main',EnableWorldBeta:'true'})
    expect(existsSync(join(root,'dist_site/index.html'))).toBe(true)
    expect(existsSync(join(root,'dist_site/public/idle.png'))).toBe(true)
    expect(existsSync(join(root,'dist_site/world'))).toBe(false)
  })
  it('stages opted-in preview, then removes its assets when staging production', () => {
    const root=fixture()
    stage(root,{WORKERS_CI_BRANCH:'main',POCKETRPG_BUILD_ENV:'preview',EnableWorldBeta:'true'})
    expect(existsSync(join(root,'dist_site/world/index.html'))).toBe(true)
    expect(existsSync(join(root,'dist_site/world/assets/world.js'))).toBe(true)
    stage(root,{WORKERS_CI_BRANCH:'main'})
    expect(existsSync(join(root,'dist_site/world'))).toBe(false)
  })
  it('fails an enabled preview build if its world client was not built', () => {
    const root=fixture()
    rmSync(join(root,'world/client/dist'),{recursive:true,force:true})
    expect(() => stage(root,{POCKETRPG_BUILD_ENV:'preview',EnableWorldBeta:'true'})).toThrow()
  })
})
