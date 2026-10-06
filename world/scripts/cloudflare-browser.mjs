import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'

export function prepareCloudflareBrowser(root) {
  if(process.platform!=='linux'||process.arch!=='x64'||!fs.readFileSync('/etc/os-release','utf8').includes('VERSION_ID="24.04"'))throw new Error('Cloudflare review requires Ubuntu 24.04 x64')
  const run=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'inherit',...options})
  const work=path.join(root,'world/.review-browser')
  const state=path.join(work,'state'),cache=path.join(work,'cache'),libs=path.join(work,'libs')
  for(const dir of [path.join(state,'lists/partial'),path.join(cache,'archives/partial'),libs])fs.mkdirSync(dir,{recursive:true})
  const aptConfig=path.join(work,'apt.conf')
  fs.writeFileSync(aptConfig,'Dir::State "'+state+'";\nDir::Cache "'+cache+'";\nDir::State::status "/var/lib/dpkg/status";\nDebug::NoLocking "true";\n')
  process.env.APT_CONFIG=aptConfig
  run('apt-get',['update'])
  const packages=new Set(['libxi6'])
  for(const directory of [root,path.join(root,'world')]) {
    const require=createRequire(path.join(directory,'package.json'))
    const cli=path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js')
    let dryRun
    try {dryRun=execFileSync(process.execPath,[cli,'install-deps','--dry-run','chromium'],{cwd:directory,encoding:'utf8'})}
    catch(error) {
      // New Playwright reports missing packages with exit 1; older versions print an install command.
      if(error.status!==1||!String(error.stdout).includes('Missing system dependencies ('))throw error
      dryRun=String(error.stdout)
    }
    const command=dryRun.match(/apt-get install -y --no-install-recommends ([a-zA-Z0-9 .+_-]+)/)
    if(command)for(const name of command[1].trim().split(/\s+/))packages.add(name)
    else if(dryRun.includes('Missing system dependencies (')) {
      for(const line of dryRun.split('\n')){const match=line.match(/^  ([a-z0-9][a-z0-9+.:_-]*)$/);if(match)packages.add(match[1])}
    } else if(!dryRun.includes('All system dependencies are installed.'))throw new Error('Cannot read Playwright Chromium dependency plan')
  }
  // Download-only resolves transitive libraries; nothing is installed on the host.
  run('apt-get',['--download-only','--assume-yes','--no-install-recommends','install',...packages])
  for(const file of fs.readdirSync(path.join(cache,'archives')).filter(f=>f.endsWith('.deb')))run('dpkg-deb',['-x',path.join(cache,'archives',file),libs])
  const fontConfig=path.join(work,'fonts.conf')
  fs.writeFileSync(fontConfig,'<?xml version="1.0"?><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>'+path.join(libs,'usr/share/fonts')+'</dir><cachedir>'+path.join(work,'font-cache')+'</cachedir></fontconfig>')
  process.env.FONTCONFIG_FILE=fontConfig
  process.env.LD_LIBRARY_PATH=[path.join(libs,'usr/lib/x86_64-linux-gnu'),path.join(libs,'lib/x86_64-linux-gnu'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
  run('npx',['playwright','install','chromium'])
  run('npm',['--prefix','world','exec','--','playwright','install','chromium'])
}
