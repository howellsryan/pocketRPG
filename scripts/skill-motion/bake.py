from pathlib import Path
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import threading,functools,json,base64,io,shutil,sys
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'public/skill-motion';OUT.mkdir(exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
metrics=[];failures=[];shots=[]
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  page=b.new_page(viewport={'width':400,'height':256});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(f'http://127.0.0.1:{server.server_port}/scripts/skill-motion/author.html');page.wait_for_function('window.__ready')
  families=page.evaluate('__families')
  families=[f for f in families if not f.startswith('mine-')]
  if len(sys.argv)>1:families=[f for f in families if f in sys.argv[1:]]
  if any(f.startswith('mine-') for f in sys.argv[1:]):
   page.goto(f'http://127.0.0.1:{server.server_port}/scripts/skill-motion/mining-author.html');page.wait_for_function('window.__ready');families=page.evaluate('__families')
  for family in families:
   for i in range(81):
    m=page.evaluate('([p,f])=>__pose(p,f,false)',[i/80,family]);metrics.append(m)
    for limb,lengths in [('arms',m['arms']),('legs',m['legs'])]:
     wanted=[.39,.39] if limb=='arms' else [.39,.40]
     if any(abs(l[j]-wanted[j])>.002 for l in lengths for j in range(2)):failures.append({'family':family,'phase':i/80,'limb':limb,'lengths':lengths})
   frames=[];masks=[]
   for i in range(24):
    page.evaluate('([p,f])=>__pose(p,f)',[i/24,family]);frames.append(Image.open(io.BytesIO(base64.b64decode(page.evaluate('__export()').split(',')[1]))).convert('RGB').resize((200,128),Image.Resampling.LANCZOS))
    masks.append(Image.open(io.BytesIO(base64.b64decode(page.evaluate('__mask()').split(',')[1]))).convert('RGB').resize((200,128),Image.Resampling.LANCZOS))
   mask=Image.new('RGB',(1200,512))
   for i,f in enumerate(masks):mask.paste(f,((i%6)*200,(i//6)*128))
   mask.save(OUT/f'{family}-mask.webp',lossless=True,method=6)
   atlas=Image.new('RGB',(1200,512))
   for i,f in enumerate(frames):atlas.paste(f,((i%6)*200,(i//6)*128))
   atlas.save(OUT/f'{family}.webp',quality=92,method=6)
   frames[18].save(OUT/f'{family}-still.webp',quality=92,method=6)
   page.evaluate('([p,f])=>__pose(p,f)',[.75,family]);shot=Image.open(io.BytesIO(base64.b64decode(page.evaluate('__export()').split(',')[1]))).convert('RGB');shots.append((family,shot))
   print(f'{family}: {(OUT/f"{family}.webp").stat().st_size} bytes',flush=True)
  b.close()
finally:server.shutdown()
sheet=Image.new('RGB',(1600,((len(shots)+3)//4)*284),'#e6dfc8');draw=ImageDraw.Draw(sheet)
for i,(name,im) in enumerate(shots):
 x=(i%4)*400;y=(i//4)*284;sheet.paste(im,(x,y));draw.text((x+8,y+261),name,fill='#33261a')
sheet.save(ROOT/'.tmp/skill-motion-contact-sheet.jpg',quality=93)
(ROOT/'.tmp/skill-motion-bake.json').write_text(json.dumps({'families':len(families),'samples':len(metrics),'failures':failures,'errors':errors,'poses':metrics}))
print('Limb failures:',len(failures),'browser errors:',errors,flush=True)
print(json.dumps(failures[:10]),flush=True)

assert not failures, 'Unreachable grip or foot target in exported poses'
assert not errors, errors
