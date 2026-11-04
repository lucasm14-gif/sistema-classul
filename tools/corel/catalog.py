import sys,os,struct,collections,re,json
exec(open('cdr2svg.py').read().split("if __name__")[0])
c=Cdr(sys.argv[1]); out_json=sys.argv[2]; out_svg=sys.argv[3]
r=c.root;i=r.find(b'stlt');l=struct.unpack('<I',r[i+4:i+8])[0];d=c.ch(i+8,l)
n=struct.unpack('<I',d[:4])[0]; nf=struct.unpack('<I',d[4:8])[0]
refs={}
p=8
for k in range(nf):
    a,_,b=struct.unpack('<3I',d[p:p+12]); refs[a]=b; p+=60
no=struct.unpack('<I',d[p:p+4])[0]; p+=4
for k in range(no):
    a,_,b=struct.unpack('<3I',d[p:p+12]); refs[a]=b; p+=12
u=struct.unpack('<%dI'%(len(d)//4),d[:len(d)//4*4])
styles={}
for j in range(len(u)-13):
    if u[j]==2 and u[j+2]==0 and u[j+3]==0 and u[j+4]==0 and u[j+5]==0 and 0<u[j+1]<100000 and u[j+6]<100000:
        styles[u[j+1]]=u[j:j+13]
def outl(k):
    if k not in c.outl: return None
    x=c.outl[k]; i=x.find(b'\x82\x00\x00\x00'); ty,cap,join,w=struct.unpack('<HHHI',x[i+4:i+14]); return (w/1e4 if ty&2 else None)
def fillblack(k):
    x=c.fills.get(k)
    if not x or len(x)<60: return False
    j=x.find(b'\x01\x0c\x00\x00\x00'); model=x[j+5]; return model!=9
objs=[]
def wk(n_):
    if n_['loda'] and n_['loda']['type'] in(1,3):
        L=n_['loda']; a=L['a']; m=n_['m']
        if 30 not in a: return
        s=struct.unpack('<I',a[20][:4])[0] if len(a.get(20,b''))>=4 else 0
        rec=styles.get(s)
        fid=refs.get(rec[6]) if rec else None; oid=rec[8] if rec else None
        P=pts(a[30]) if L['type']==3 else [(0,0,0),(struct.unpack('<d',a[30][:8])[0],0,0x40),(struct.unpack('<d',a[30][:8])[0],struct.unpack('<d',a[30][8:16])[0],0x40),(0,struct.unpack('<d',a[30][8:16])[0],0x48)]
        XY=[ap(m,p[0],p[1]) for p in P]
        xs=[q[0]/1e4 for q in XY]; ys=[-q[1]/1e4 for q in XY]
        objs.append({'P':P,'m':m,'bb':(min(xs),min(ys),max(xs),max(ys)),'type':L['type'],'style':s,'rec':bool(rec),'w':outl(oid) if oid else None,'fill':fillblack(fid) if fid else False,'closed':any(p[2]&8 for p in P),'n':len(P)})
    for k in n_['kids']: wk(k)
wk(c.tree)
# placas: retângulos reais, sem nada maior contendo-os e com medida de placa
def area(b): return (b[2]-b[0])*(b[3]-b[1])
rects=[o for o in objs if (o['type']==1 or o['n'] in(4,5)) and 60<o['bb'][2]-o['bb'][0]<420 and 60<o['bb'][3]-o['bb'][1]<420]
rects.sort(key=lambda o:area(o['bb']),reverse=True)
cells=[]
for o in rects:
    b=o['bb']
    kids=[x for x in objs if x is not o and x['bb'][0]>=b[0]-.5 and x['bb'][1]>=b[1]-.5 and x['bb'][2]<=b[2]+.5 and x['bb'][3]<=b[3]+.5]
    cells.append({'o':o,'kids':kids})
# célula = retângulo que não está dentro de outro com mesmo grupo de filhos (remove retângulos internos da moldura)
final=[]
for ce in cells:
    b=ce['o']['bb']
    if any(f['o']['bb'][0]<=b[0] and f['o']['bb'][1]<=b[1] and f['o']['bb'][2]>=b[2] and f['o']['bb'][3]>=b[3] for f in final): continue
    final.append(ce)
print('objs',len(objs),'placas',len(final))
res=[];sheet=[];X=0;Y=0;rowH=0
for idx,ce in enumerate(sorted(final,key=lambda c:(round(c['o']['bb'][1]/100),c['o']['bb'][0]))):
    b=ce['o']['bb']; w=b[2]-b[0]; h=b[3]-b[1]
    items=[]
    for x in ce['kids']:
        if x['n'] in (4,5) and not x['w'] and not (x['fill'] and (x['bb'][2]-x['bb'][0])*(x['bb'][3]-x['bb'][1])<0.3*w*h): x=dict(x,w=0.2)
        items.append({'d':d_path(x['P'],(x['m'][0],x['m'][1],x['m'][2]-b[0]*1e4,x['m'][3],x['m'][4],x['m'][5]+b[1]*1e4)),'w':x['w'],'fill':x['fill'] and x['closed'] and (x['bb'][2]-x['bb'][0])*(x['bb'][3]-x['bb'][1])<0.3*w*h,'n':x['n']})
    res.append({'idx':idx,'mm':[round(w,1),round(h,1)],'items':items,'bbox':b})
    if X+w>1000: X=0;Y+=rowH+30;rowH=0
    body=''.join(f'<path d="{i["d"]}" fill="{"#000" if i["fill"] else "none"}" stroke="{"#000" if i["w"] else "none"}" stroke-width="{i["w"] or 0}"/>' for i in items)
    sheet.append(f'<g transform="translate({X} {Y})"><rect width="{w}" height="{h}" fill="#f4f4f4" stroke="#c00" stroke-width=".3"/>{body}<text y="-3" font-size="10" font-family="Arial">#{idx} {w:.0f}x{h:.0f}mm · {len(items)} obj</text></g>')
    X+=w+20; rowH=max(rowH,h)
json.dump(res,open(out_json,'w'))
open(out_svg,'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="{Y+rowH+40}" viewBox="-5 -15 1020 {Y+rowH+40}"><rect x="-5" y="-15" width="100%" height="100%" fill="#fff"/>{"".join(sheet)}</svg>')
for r_ in res: print(r_['idx'],r_['mm'],len(r_['items']),sum(i['n'] for i in r_['items']),'styled',sum(1 for i in r_['items'] if i['w'] or i['fill']))
