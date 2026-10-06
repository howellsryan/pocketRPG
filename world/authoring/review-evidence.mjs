export function validateReviewEvidence({report,evidence,receipt,commit,files}) {
  if(!/^[a-f0-9]{64}$/.test(report.sourceHash)||evidence.sourceHash!==report.sourceHash)throw new Error('Review source mismatch')
  if(!/^[a-f0-9]{40}$/.test(commit)||evidence.commit!==commit)throw new Error('Review commit mismatch')
  const region=evidence.region
  if(!/^[a-z][a-z0-9_]*$/.test(region))throw new Error('Invalid review region')
  const required=report.reviewViews.flatMap(v=>v.mode==='overview'?['desktop:'+v.id]:['desktop:'+v.id,'mobile:'+v.id,'integrated:'+v.id])
  const seen=new Set()
  for(const capture of evidence.captures) {
    if(!required.includes(capture.id)||seen.has(capture.id))throw new Error('Unexpected or duplicated capture '+capture.id)
    seen.add(capture.id)
    const mobile=capture.id.startsWith('mobile:')
    if(capture.viewport.width!==(mobile?390:1280)||capture.viewport.height!==(mobile?844:800))throw new Error('Wrong capture viewport '+capture.id)
    if(!/^(desktop|mobile|integrated)-[a-z0-9_-]+\.png$/.test(capture.file)||capture.file!==capture.id.replace(':','-')+'.png')throw new Error('Invalid capture file')
    if(!files.has(region+'/'+capture.file))throw new Error('Missing capture file '+capture.file)
  }
  if(seen.size!==required.length)throw new Error('Incomplete capture coverage')
  for(const state of ['idle','attack','hit','death'])if(!files.has('creatures/dustpaw_rat-'+state+'.png'))throw new Error('Missing creature state file '+state)
  const approved=receipt?.sourceHash===report.sourceHash&&receipt.verdict==='approved'&&receipt.reviewedBy&&receipt.evidenceUrl&&required.every(v=>receipt.views?.includes(v))
  return {schemaVersion:1,region,commit,sourceHash:report.sourceHash,approval:approved?'approved':'pending',scope:approved?(receipt.scope??'See versioned review receipt'):'Awaiting inspection and a current-source receipt',views:required}
}
