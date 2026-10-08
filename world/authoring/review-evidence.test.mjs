import test from 'node:test'
import assert from 'node:assert/strict'
import {validateReviewEvidence} from './review-evidence.mjs'
function fixture() {
  const report={region:'lumbright',sourceHash:'a'.repeat(64),reviewViews:[{id:'overview',mode:'overview'},{id:'bank',mode:'gameplay'}]}
  const captures=['desktop:overview','desktop:bank','mobile:bank','integrated:bank'].map(id=>({id,file:id.replace(':','-')+'.png',viewport:id.startsWith('mobile:')?{width:390,height:844}:{width:1280,height:800}}))
  const commit='b'.repeat(40)
  const evidence={region:'lumbright',sourceHash:report.sourceHash,commit,captures}
  const receipt={region:'lumbright',sourceHash:report.sourceHash,verdict:'approved',reviewedBy:'reviewer',evidenceUrl:'https://example.com/evidence',views:captures.map(c=>c.id)}
  const files=new Set([...captures.map(c=>'lumbright/'+c.file),...['idle','attack','hit','death'].map(s=>'creatures/dustpaw_rat-'+s+'.png'),...['idle','attack','hit','death','walk'].map(s=>'creatures/cave_goblin-'+s+'.png')])
  return {report,evidence,receipt,commit,files}
}
test('a complete current-source capture retains a matching human approval',()=>{
  assert.equal(validateReviewEvidence(fixture()).approval,'approved')
})
test('a new source publishes evidence as pending instead of carrying forward an older approval',()=>{
  const f=fixture();f.receipt.sourceHash='c'.repeat(64)
  assert.equal(validateReviewEvidence(f).approval,'pending')
})
test('a matching hash without a named reviewer remains pending',()=>{
  const f=fixture();delete f.receipt.reviewedBy
  assert.equal(validateReviewEvidence(f).approval,'pending')
})
test('a missing portrait view cannot be published as a complete review',()=>{
  const f=fixture();f.evidence.captures=f.evidence.captures.filter(c=>c.id!=='mobile:bank')
  assert.throws(()=>validateReviewEvidence(f),/capture/i)
})
test('a duplicated view cannot disguise missing coverage',()=>{
  const f=fixture();f.evidence.captures[2]=f.evidence.captures[1]
  assert.throws(()=>validateReviewEvidence(f),/capture/i)
})
test('evidence from another source or commit cannot receive the current label',()=>{
  const f=fixture();f.evidence.sourceHash='c'.repeat(64)
  assert.throws(()=>validateReviewEvidence(f),/source/i)
  f.evidence.sourceHash=f.report.sourceHash;f.evidence.commit='c'.repeat(40)
  assert.throws(()=>validateReviewEvidence(f),/commit/i)
})
test('portrait evidence must have been captured at the actual portrait viewport',()=>{
  const f=fixture();f.evidence.captures[2].viewport={width:1280,height:800}
  assert.throws(()=>validateReviewEvidence(f),/viewport/i)
})
test('missing screenshots and missing death-state renders stop publication',()=>{
  const f=fixture();f.files.delete('lumbright/mobile-bank.png')
  assert.throws(()=>validateReviewEvidence(f),/file/i)
  const g=fixture();g.files.delete('creatures/dustpaw_rat-death.png')
  assert.throws(()=>validateReviewEvidence(g),/file/i)
})
test('approval must cover every required view even when screenshots are complete',()=>{
  const f=fixture();f.receipt.views=f.receipt.views.filter(v=>v!=='integrated:bank')
  assert.equal(validateReviewEvidence(f).approval,'pending')
})

test('a candidate without a receipt still publishes for inspection with approval pending',()=>{const f=fixture();f.receipt=null;assert.equal(validateReviewEvidence(f).approval,'pending')})

test('another region cannot supply evidence for this report',()=>{
 const f=fixture();f.evidence.region='seerhold'
 assert.throws(()=>validateReviewEvidence(f),/region/i)
})
test('another region receipt cannot approve this report',()=>{
 const f=fixture();f.receipt.region='seerhold'
 assert.equal(validateReviewEvidence(f).approval,'pending')
})
test('a town with no rat does not require unrelated creature state files',()=>{
 const f=fixture();f.report.region='seerhold';f.evidence.region='seerhold';f.receipt.region='seerhold'
 f.files=new Set(f.evidence.captures.map(c=>'seerhold/'+c.file))
 assert.equal(validateReviewEvidence(f).approval,'approved')
})

test('Lumbright evidence requires the goblin movement pose as well as combat states',()=>{
  const f=fixture();f.files.delete('creatures/cave_goblin-walk.png')
  assert.throws(()=>validateReviewEvidence(f),/cave_goblin:walk/)
})
