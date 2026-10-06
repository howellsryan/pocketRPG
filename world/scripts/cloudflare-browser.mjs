import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'

export function prepareCloudflareBrowser(root) {
  if(process.platform!=='linux'||process.arch!=='x64'||!fs.readFileSync('/etc/os-release','utf8').includes('VERSION_ID="24.04"'))throw new Error('Cloudflare review requires Ubuntu 24.04 x64')
  const run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'inherit',...options})
  const packages=new Set(['libxi6'])
  for(const directory of [root,path.join(root,'world')]) {
    const require=createRequire(path.join(directory,'package.json'))
    const core=path.dirname(require.resolve('playwright-core/package.json'))
    const {deps}=require(path.join(core,'lib/server/registry/nativeDeps.js'))
    for(const name of deps['ubuntu24.04-x64'].chromium)packages.add(name)
  }
  const work=path.join(root,'world/.review-browser')
  const state=path.join(work,'state'),cache=path.join(work,'cache'),debs=path.join(work,'debs'),libs=path.join(work,'libs')
  for(const dir of [path.join(state,'lists/partial'),path.join(cache,'archives/partial'),debs,libs])fs.mkdirSync(dir,{recursive:true})
  const options=['-o','Dir::State='+state,'-o','Dir::Cache='+cache,'-o','Dir::State::status=/var/lib/dpkg/status','-o','Debug::NoLocking=1']
  run('apt-get',[...options,'update'])
  // Download-only resolves missing transitive libraries; nothing is installed on the host.
  run('apt-get',[...options,'--download-only','--assume-yes','--no-install-recommends','install',...packages])
  for(const file of fs.readdirSync(path.join(cache,'archives')).filter(f=>f.endsWith('.deb')))run('dpkg-deb',['-x',path.join(cache,'archives',file),libs])
  process.env.LD_LIBRARY_PATH=[path.join(libs,'usr/lib/x86_64-linux-gnu'),path.join(libs,'lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
  run('npx',['playwright','install','chromium'])
  run('npm',['--prefix','world','exec','--','playwright','install','chromium'])
}
