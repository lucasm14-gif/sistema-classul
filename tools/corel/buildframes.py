import json,re
exec(open('catalog_lib.py').read()) if False else None
cat=json.load(open('r/cat.json'))
W=2000
SZ={'9x14':(14,9),'12x17':(17,12),'14x20':(20,14),'16x25':(25,16),'20x30':(30,20)}
def H(k): h,w=map(int,k.split('x')); return round(W*h/w)
FAM={'cantos-recortados':{'9x14':2,'12x17':8,'14x20':12,'16x25':21},
'cantos-folhas':{'9x14':3,'12x17':9,'14x20':13,'16x25':17},
'arabesco':{'9x14':4,'12x17':10,'14x20':14,'16x25':18,'20x30':22},
'cantos-flor':{'9x14':5,'12x17':11,'14x20':15,'16x25':19},
'chanfrado':{'14x20':23,'16x25':24},
'filete-quadrados':{'9x14':1}}
num=re.compile(r'-?\d+\.\d+')
def scale(d,sx,sy):
    i=[0]
    def f(m):
        v=float(m.group()); r=v*(sx if i[0]%2==0 else sy); i[0]+=1
        s=f'{r:.1f}'; return s[:-2] if s.endswith('.0') else s
    return num.sub(f,d)
def asp(k): a,b=map(int,k.split('x')); return b/a
out={}
for fam,cells in FAM.items():
    out[fam]={}
    for size in SZ:
        src=size if size in cells else min(cells,key=lambda k:abs(asp(k)-asp(size)))
        c=cat[cells[src]]; mw,mh=c['mm']
        sx=W/mw; sy=H(size)/mh; items=[]
        for it in c['items']:
            nums=[float(v) for v in num.findall(it['d'])]; xs=nums[0::2]; ys=nums[1::2]
            bw=max(xs)-min(xs); bh=max(ys)-min(ys)
            if fam=='chanfrado' and bw<0.8*mw and bh<0.8*mh and it['n']<=20 and min(xs)>mw*0.1: continue   # placa menor empilhada dentro
            w=it['w'] if it['w'] else (None if it['fill'] else 0.2)
            o={'d':scale(it['d'],sx,sy)}
            if it['fill']: o['f']=1
            if w: o['w']=round(w*sx,2)
            items.append(o)
        out[fam][size]=items
open('/Users/lucasmac/Desktop/sistema classul/web/src/plates/frames.js','w').write('// Molduras extraídas de "Molduras_top Lucas Leiria.cdr", em unidades da placa (largura 2000).\n// Gerado por script: não editar à mão. d = traçado, f = preenchido, w = espessura.\nexport const FRAMES = '+json.dumps(out,separators=(',',':'))+';\n')
import os; print(os.path.getsize('/Users/lucasmac/Desktop/sistema classul/web/src/plates/frames.js'))
for f in out: print(f,{k:len(v) for k,v in out[f].items()})
