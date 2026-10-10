from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
import threading,functools,json,importlib.util,numpy as np
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('clearance',ROOT/'scripts/skill-motion/geometry.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
original_surface_distance=mod.surface_distance
# Exact broad phase: a real point-to-centroid distance bounds the nearest surface.
# Retain all triangles whose AABB could beat it, plus the full capsule radius.
def fast_surface_distance(points,triangles):
 pts=np.asarray(points);tri=np.asarray(triangles)
 centers=tri.mean(axis=1)
 seeds=pts[[0,len(pts)//2,-1]]
 upper=np.linalg.norm(seeds[:,None,:]-centers[None,:,:],axis=2).min()+.08
 delta=np.maximum(np.maximum(tri.min(axis=1)-pts.max(axis=0),pts.min(axis=0)-tri.max(axis=1)),0)
 eligible=np.linalg.norm(delta,axis=1)<=upper
 return original_surface_distance(pts,tri[eligible])
mod.surface_distance=fast_surface_distance
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
rows=[];failures=[]
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=b.new_page(viewport={'width':400,'height':256});page.goto(f'http://127.0.0.1:{server.server_port}/scripts/skill-motion/author.html');page.wait_for_function('__ready');page.evaluate('__snapshot()');localBody=[np.asarray(t) for t in page.evaluate('__bodyData()')]
  for family in page.evaluate('__families'):
   if family=='mine-pick':
    page.goto(f'http://127.0.0.1:{server.server_port}/scripts/skill-motion/mining-author.html');page.wait_for_function('__ready');page.evaluate('__snapshot()');localBody=[np.asarray(t) for t in page.evaluate('__bodyData()')]
   if family=='chop-axe':
    page.goto(f'http://127.0.0.1:{server.server_port}/scripts/skill-motion/author.html');page.wait_for_function('__ready');page.evaluate('__snapshot()');localBody=[np.asarray(t) for t in page.evaluate('__bodyData()')]
   minimum={'shaft':1.,'forearm0':1.,'forearm1':1.};bad=[];lengthError=0.;contactError=0.;footSlide=0.;initialFeet=None
   for i in range(160):
    data=page.evaluate('([p,f])=>{__pose(p,f,false);return __compact()}',[i/160,family]);matrices=[np.asarray(m).reshape(4,4).T for m in data['matrices']];body=np.concatenate([np.matmul(t,m[:3,:3].T)+m[:3,3] for t,m in zip(localBody,matrices)])
    if initialFeet is None:initialFeet=np.asarray(data['feet'])
    if family not in ['agility','dungeon']:footSlide=max(footSlide,float(np.linalg.norm(np.asarray(data['feet'])-initialFeet,axis=1).max()))
    lengthError=max(lengthError,max(abs(l[j]-[.39,.39][j]) for l in data['arms'] for j in range(2)),max(abs(l[j]-[.39,.40][j]) for l in data['legs'] for j in range(2)))
    values={'shaft':float(mod.surface_distance(mod.line_points(data['shaft'],81),body).min()-.038) if data['shaft'] else 1.}
    for j,line in enumerate(data['forearms']):values[f'forearm{j}']=float((mod.surface_distance(mod.line_points(line,61),body)-np.linspace(.066,.045,61)).min())
    for k,n in values.items():minimum[k]=min(minimum[k],n)
    if any(n<0 for n in values.values()):bad.append({'phase':i/160,**values})
    if i==0 and data['contact'] and data['tip']:contactError=float(np.linalg.norm(np.array(data['contact'])-data['tip']))
   r={'family':family,'samples':160,'minimum':minimum,'lengthError':lengthError,'contactError':contactError,'footSlide':footSlide,'bad':bad};rows.append(r)
   print(f'{family}: length {lengthError:.6f}; clearance {min(minimum.values()):.6f}; contact {contactError:.6f}; worst '+json.dumps(min(bad,key=lambda x:min(x[k] for k in minimum)) if bad else {}),flush=True)
   if lengthError>.002 or min(minimum.values())<0 or contactError>.001 or footSlide>.001:failures.append(r)
  b.close()
finally:server.shutdown()
report={'families':len(rows),'samples':len(rows)*160,'failures':failures,'results':rows}
(ROOT/'.tmp/skill-motion-clearance.json').write_text(json.dumps(report,indent=2));print('Failing families:',len(failures),flush=True)

assert not failures, 'Body penetration, limb stretching or missed contact'
