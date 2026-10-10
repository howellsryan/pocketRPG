from pathlib import Path
from playwright.sync_api import sync_playwright
import json,threading,functools,shutil
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.tmp/skill-motion-browser';OUT.mkdir(exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'.tmp/skill-motion-review')))
threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1360,'height':1000});errors=[];failed=[];methods=[];counts={}
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('response',lambda r:failed.append({'status':r.status,'url':r.url}) if r.status>=400 else None)
 page.goto(URL);page.wait_for_selector('canvas.is-ready',timeout=20000)
 page.get_by_role('button',name='Pause',exact=True).click()
 def ready():
  page.wait_for_timeout(80)
  page.wait_for_selector('.review-enlarged canvas.is-ready',timeout=20000)
 def pixels():return page.locator('.review-enlarged canvas').evaluate('(e)=>e.toDataURL()')
 def rewardVisible():return page.locator('.skill-motion-rewards').count()>0 and page.locator('.skill-motion-rewards').evaluate('(e)=>getComputedStyle(e).visibility')=='visible'
 for tile in page.locator('.review-method-grid button').all():
  family=tile.inner_text().strip().lower().replace(' ','-');tile.click();page.wait_for_selector(f'[data-motion="{family}"] canvas.is-ready',timeout=20000)
  for frame in [0,6,12,18,23]:page.get_by_role('slider',name='Inspect motion frame').fill(str(frame))
  assert page.locator('[data-family]').inner_text()==family,family
  methods.append(family)
  if len(methods)%10==0:print('Methods checked',len(methods),flush=True)
 assert len(methods)==56
 for tab in page.locator('nav[aria-label="Skills"] button').all():
  name=tab.inner_text();tab.click();ready();options=page.get_by_role('combobox',name='Action',exact=True).locator('option').evaluate_all('(es)=>es.map(e=>e.value)');counts[name]=len(options)
  print('Checking',name,len(options),flush=True)
  for value in options:
   page.get_by_role('combobox',name='Action',exact=True).select_option(value);ready()
   assert page.locator('[data-family]').inner_text() in methods
   assert not rewardVisible(),name+': stale reward on selection'
 print('Methods',len(methods),'actions',counts,flush=True)
 assert sum(v for k,v in counts.items() if k!='Farming')==339,counts
 assert counts['Farming']==58
 page.get_by_role('button',name='Woodcutting',exact=True).click();ready();page.get_by_role('combobox',name='Action',exact=True).select_option('magic');page.get_by_role('combobox',name='Tool',exact=True).select_option('none');ready()
 page.get_by_role('button',name='Preview completion',exact=True).click();page.wait_for_timeout(80);assert rewardVisible()
 page.get_by_role('combobox',name='Outcome',exact=True).select_option('zero');page.get_by_role('button',name='Preview completion',exact=True).click();page.wait_for_timeout(80);assert not rewardVisible()
 page.get_by_role('combobox',name='Outcome',exact=True).select_option('normal');page.get_by_role('button',name='Preview completion',exact=True).click();page.wait_for_timeout(80);assert rewardVisible()
 page.get_by_role('button',name='Fishing',exact=True).click();ready();assert not rewardVisible()
 page.get_by_role('combobox',name='Tool',exact=True).select_option('lobster_cage');ready();page.get_by_role('slider',name='Inspect motion frame').fill('18');page.wait_for_timeout(80);page.screenshot(path=str(OUT/'gallery-cage.png'))
 page.get_by_role('button',name='Cooking',exact=True).click();ready();page.get_by_role('combobox',name='Outcome',exact=True).select_option('burn');page.get_by_role('button',name='Preview completion',exact=True).click();page.wait_for_timeout(80);assert rewardVisible();assert '+1' in page.locator('.skill-motion-rewards').inner_text()
 page.get_by_role('button',name='Mining',exact=True).click();ready();page.get_by_role('combobox',name='Action',exact=True).select_option('gem_mining');ready();page.get_by_role('combobox',name='Outcome',exact=True).select_option('multi');page.get_by_role('button',name='Preview completion',exact=True).click();page.wait_for_timeout(80);assert page.locator('.skill-motion-rewards b').count()>1
 page.get_by_role('button',name='Woodcutting',exact=True).click();ready();page.get_by_role('combobox',name='Action',exact=True).select_option('magic');page.get_by_role('combobox',name='Tool',exact=True).select_option('dragon_axe');ready()
 page.wait_for_timeout(250);ready();first=pixels();page.wait_for_timeout(350);assert pixels()==first,'Paused animation moved'
 page.get_by_role('button',name='Play',exact=True).click();page.wait_for_timeout(370);assert pixels()!=first,'Playing animation did not move'
 page.evaluate("Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'))")
 frozen=pixels();page.wait_for_timeout(250);assert pixels()==frozen,'Hidden animation moved'
 page.get_by_role('button',name='Preview completion',exact=True).click();page.wait_for_timeout(80);assert not rewardVisible(),'Hidden completion replayed'
 page.evaluate("Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'))");page.wait_for_timeout(80);assert not rewardVisible(),'Hidden reward replayed on return'
 page.get_by_role('button',name='Pause',exact=True).click();page.get_by_role('slider',name='Inspect motion frame').fill('0');page.wait_for_timeout(80);page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/'gallery-desktop-final.png'),full_page=True)
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'gallery-mobile-final.png'),full_page=True);width=page.evaluate('document.documentElement.scrollWidth');assert width<=390,width
 reduced=b.new_page(reduced_motion='reduce');reduced.on('pageerror',lambda e:errors.append(str(e)));reduced.goto(URL);reduced.get_by_role('combobox',name='Action',exact=True).select_option('magic');reduced.get_by_role('combobox',name='Tool',exact=True).select_option('none');reduced.wait_for_selector('canvas.is-ready');reduced.get_by_role('button',name='Play',exact=True).click();reduced.get_by_role('button',name='Preview completion',exact=True).click();reduced.wait_for_timeout(1200)
 assert reduced.locator('.skill-motion-rewards').evaluate('(e)=>getComputedStyle(e).visibility')=='hidden','Reduced reward lingered'
 rp=reduced.locator('.review-enlarged canvas').evaluate('(e)=>e.toDataURL()');reduced.wait_for_timeout(300);assert reduced.locator('.review-enlarged canvas').evaluate('(e)=>e.toDataURL()')==rp
 assert not errors,errors
 assert not failed,failed
 report={'methods':methods,'actionCounts':counts,'recurringActions':339,'farmingOperations':58,'errors':errors,'failedRequests':failed,'mobileWidth':width,'lifecycle':['paused freeze','play advances','scrub five poses per family','new completion rewards','zero output','burnt food','multiple drops','no stale rewards on action switch','reduced static pose','reduced reward expiry','hidden freeze','no hidden reward replay']}
 (OUT/'browser-final.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True);b.close()

server.shutdown()
