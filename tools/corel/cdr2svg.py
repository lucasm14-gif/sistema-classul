import zipfile,struct,sys,json,collections,re
IDENT=(1,0,0,0,1,0)
def mul(a,b): return (a[0]*b[0]+a[1]*b[3], a[0]*b[1]+a[1]*b[4], a[0]*b[2]+a[1]*b[5]+a[2], a[3]*b[0]+a[4]*b[3], a[3]*b[1]+a[4]*b[4], a[3]*b[2]+a[4]*b[5]+a[5])
def ap(m,x,y): return (m[0]*x+m[1]*y+m[2], m[3]*x+m[4]*y+m[5])
class Cdr:
    def __init__(s,path):
        z=zipfile.ZipFile(path); s.names=z.read('content/dataFileList.dat').decode().split()
        s.st=[z.read('content/data/'+n) for n in s.names]; s.root=z.read('content/root.dat')
        s.fills={};s.outl={}
        s.tree=s.list(12,len(s.root),'root')
    def ch(s,o,ln):
        if ln==16:
            sid,l,off,_=struct.unpack('<IIII',s.root[o:o+16])
            return None if sid==0xffffffff else s.st[sid][off:off+l]
        return s.root[o:o+ln]
    def list(s,o,end,kind):
        n={'kind':kind,'kids':[],'m':IDENT,'loda':None}
        while o+8<=end:
            cc=s.root[o:o+4]; ln=struct.unpack('<I',s.root[o+4:o+8])[0]
            if cc in(b'RIFF',b'LIST'):
                k=s.root[o+8:o+12].decode('latin1').strip()
                c=s.list(o+12,o+8+ln,k)
                if k in('lgob','trfl'):
                    if c['m']!=IDENT: n['m']=c['m']
                    if c['loda'] is not None: n['loda']=c['loda']
                    n['kids']+=c['kids']
                else: n['kids'].append(c)
            elif cc==b'loda': n['loda']=s.pl(s.ch(o+8,ln))
            elif cc==b'trfd':
                d=s.ch(o+8,ln)
                if d:
                    a=struct.unpack('<I',d[16:20])[0] if False else 0x18
                    n['m']=struct.unpack('<6d',d[40:88])
            elif cc==b'fild':
                d=s.ch(o+8,ln); 
                if d: s.fills[struct.unpack('<I',d[:4])[0]]=d
            elif cc==b'outl':
                d=s.ch(o+8,ln)
                if d: s.outl[struct.unpack('<I',d[:4])[0]]=d
            o+=8+ln+(ln&1)
        return n
    def pl(s,d):
        ln,na,sa,st,ct=struct.unpack('<5I',d[:20])
        off=struct.unpack('<%dI'%na,d[sa:sa+4*na]); ty=struct.unpack('<%dI'%na,d[st:st+4*na])[::-1]
        r={'type':ct,'a':{}}
        order=sorted(range(na),key=lambda i:off[i])
        for idx,i in enumerate(order):
            e=off[order[idx+1]] if idx+1<na else min(sa,st)
            r['a'][ty[i]]=d[off[i]:e]
        return r
def pts(c):
    n=struct.unpack('<I',c[:4])[0]
    v=struct.unpack('<%di'%(2*n),c[4:4+8*n]); t=c[4+8*n:4+9*n]
    return [(v[2*i],v[2*i+1],t[i]) for i in range(n)]
def d_path(P,m):
    out=[];i=0;n=len(P)
    while i<n:
        x,y,t=P[i]; X,Y=ap(m,x,y)
        tt=t&0xc0
        if tt==0: out.append(f'M{X/1e4:.3f} {-Y/1e4:.3f}'); i+=1
        elif tt==0x40: out.append(f'L{X/1e4:.3f} {-Y/1e4:.3f}'); i+=1
        else:
            if i+2>=n: break
            a=ap(m,P[i][0],P[i][1]);b=ap(m,P[i+1][0],P[i+1][1]);c=ap(m,P[i+2][0],P[i+2][1])
            out.append(f'C{a[0]/1e4:.3f} {-a[1]/1e4:.3f} {b[0]/1e4:.3f} {-b[1]/1e4:.3f} {c[0]/1e4:.3f} {-c[1]/1e4:.3f}'); i+=3
        if t&0x08: out.append('Z')
    return ''.join(out)
def collect(n,m,out,cnt,pg=None,usegrp=True):
    mm=mul(m,n['m']) if (usegrp or n['kind']!='grp') else m
    if n['kind']=='page': pg=(pg or 0)
    if n['loda']:
        l=n['loda']; t=l['type']; cnt[t]+=1
        if 30 in l['a']:
            c=l['a'][30]
            if t==3:
                out.append({'d':d_path(pts(c),mm),'fill':l['a'].get(20,b'')[:4],'outl':l['a'].get(10,b'')[:4],'bb':None})
            elif t==1:
                vals=struct.unpack('<2d',c[:16]); x,y=vals
                P=[(0,0,0),(x,0,0x40),(x,y,0x40),(0,y,0x48)]
                out.append({'d':d_path(P,mm),'fill':l['a'].get(20,b'')[:4],'outl':l['a'].get(10,b'')[:4]})
    for k in n['kids']: collect(k,mm,out,cnt,pg,usegrp)
if __name__=='__main__':
    c=Cdr(sys.argv[1]); out=[];cnt=collections.Counter()
    collect(c.tree,IDENT,out,cnt,None,len(sys.argv)<4)
    xs=[];ys=[]
    for o in out:
        nums=[float(v) for v in re.findall(r'-?\d+\.\d+',o['d'])]; xs+=nums[0::2];ys+=nums[1::2]
    print('objs',len(out),cnt,'bbox',min(xs),min(ys),max(xs),max(ys),'fills',len(c.fills),'outl',len(c.outl))
    x0,y0,x1,y1=min(xs),min(ys),max(xs),max(ys)
    body=''.join(f'<path d="{o["d"]}"/>' for o in out)
    open(sys.argv[2],'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1600" viewBox="{x0-5} {y0-5} {x1-x0+10} {y1-y0+10}"><rect x="{x0-5}" y="{y0-5}" width="100%" height="100%" fill="#fff"/><g fill="none" stroke="#000" stroke-width="0.25">{body}</g></svg>')
