import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Award, ClipboardCopy, Download, FileCode2, ImagePlus, LoaderCircle, Sparkles, TriangleAlert, X } from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';
import { sceneForCorel } from '../plates/print';
import { buildScene, checkFields, drawScene, FONT_LOADS, FONTS_URL, plateHeight, SIZES, TEMPLATES, toSvg, W } from '../plates/engine';

const card = 'bg-white rounded-3xl border border-black/5 shadow-sm';
const input = 'w-full bg-black/[0.03] border border-black/5 rounded-xl px-3 py-2 text-sm font-medium text-brand-950 outline-none focus:border-brand-400';
const label = 'block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5';

const EMPTY = { name: '', title: '', body: '', line: '', from: '', signatures: [], logo: null, photo: null };
const EXAMPLE = { ...EMPTY, name: 'Nome do homenageado', title: 'Título da homenagem', body: 'A mensagem da placa aparece aqui. Cole a conversa ao lado ou preencha os campos.', line: 'Novembro/2026', from: 'Quem homenageia' };

// Mede com o canvas, usando as mesmas fontes que a arte vai desenhar.
const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const measure = (text, css) => {
  measureCtx.font = css;
  return measureCtx.measureText(text).width;
};

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const el = new Image();
      el.onerror = reject;
      el.onload = () => resolve({ src: reader.result, w: el.naturalWidth, h: el.naturalHeight, el });
      el.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function ImagePick({ title, value, onChange }) {
  const ref = useRef(null);
  const toast = useToast();
  return (
    <div>
      <span className={label}>{title}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => ref.current?.click()} className="flex-1 flex items-center justify-center gap-2 border border-dashed border-black/15 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:border-brand-400">
          {value ? <img src={value.src} alt="" className="h-6 max-w-[80px] object-contain" /> : <ImagePlus size={15} />}
          {value ? 'Trocar' : 'Escolher imagem'}
        </button>
        {value ? <button type="button" onClick={() => onChange(null)} aria-label={`Remover ${title}`} className="p-2 text-slate-400 hover:text-flame-600"><X size={15} /></button> : null}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try { onChange(await readImage(file)); } catch { toast('Não consegui abrir essa imagem.', 'error'); }
        }}
      />
    </div>
  );
}

export default function Arts({ onAuthError }) {
  const toast = useToast();
  const [conversation, setConversation] = useState('');
  const [fields, setFields] = useState(EMPTY);
  const [templateId, setTemplateId] = useState('classica');
  const [size, setSize] = useState('14x20');
  const [doubts, setDoubts] = useState([]);
  const [reading, setReading] = useState(false);
  const [fontsReady, setFontsReady] = useState(0);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!document.getElementById('plate-fonts')) {
      const link = document.createElement('link');
      link.id = 'plate-fonts';
      link.rel = 'stylesheet';
      link.href = FONTS_URL;
      document.head.appendChild(link);
    }
    let alive = true;
    Promise.all(FONT_LOADS.map((f) => document.fonts.load(f, 'Áa'))).catch(() => {}).finally(() => { if (alive) setFontsReady((n) => n + 1); });
    return () => { alive = false; };
  }, []);

  // Qualquer mudança invalida a conferência humana.
  useEffect(() => { setChecked(false); }, [fields, templateId, size]);

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const hasContent = Boolean(fields.name || fields.body);
  const shown = hasContent ? fields : EXAMPLE;

  const scenes = useMemo(
    () => TEMPLATES.map((t) => buildScene(t.id, shown, size, measure)),
    [shown, size, fontsReady] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const scene = scenes.find((s) => s.template.id === templateId) || scenes[0];
  const issues = useMemo(() => (hasContent ? checkFields(fields, scene) : []), [hasContent, fields, scene]);
  const hasError = issues.some((i) => i.level === 'erro');
  const ready = hasContent && checked && !hasError;

  const readConversation = async () => {
    setReading(true);
    try {
      const data = await api.artExtract(conversation);
      setFields((f) => ({ ...f, name: data.name, title: data.title, body: data.body, line: data.line, from: data.from, signatures: data.signatures || [] }));
      setTemplateId(data.template);
      if (data.size) setSize(data.size);
      const extra = [];
      if (data.needsLogo) extra.push('O cliente quer logotipo: adicione o arquivo.');
      if (data.needsPhoto) extra.push('O cliente quer foto gravada: adicione a imagem.');
      setDoubts([...data.doubts, ...extra]);
    } catch (err) {
      if (!onAuthError?.(err)) toast(err.message, 'error');
    } finally {
      setReading(false);
    }
  };

  const fileBase = () => `placa-${(fields.name || 'arte').normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase()}-${size}`;

  const toPngBlob = () => new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = plateHeight(size);
    drawScene(c.getContext('2d'), scene, Path2D);
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), 'image/png');
  });

  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const copyPng = async () => {
    try {
      const item = new ClipboardItem({ 'image/png': toPngBlob() });
      await navigator.clipboard.write([item]);
      toast('Imagem copiada. Cole na conversa do WhatsApp.', 'success');
    } catch {
      toast('O navegador não deixou copiar. Use "Baixar PNG".', 'error');
    }
  };

  const savePng = async () => download(await toPngBlob(), `${fileBase()}.png`);
  const saveSvg = async () => {
    try {
      const svg = toSvg(await sceneForCorel(scene), { production: true });
      download(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase()}-corel.svg`);
    } catch {
      toast('Não consegui preparar a imagem para o Corel.', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold text-brand-950 flex items-center gap-2"><Award size={24} /> Artes de placa</h1>
        <p className="text-sm text-slate-500 mt-1">Protótipo: a IA separa os textos e a arte sai no modelo. Nada é enviado ao cliente sem você conferir.</p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className={`${card} p-5 space-y-3`}>
            <label htmlFor="art-conv" className={label}>Conversa do WhatsApp</label>
            <textarea id="art-conv" value={conversation} onChange={(e) => setConversation(e.target.value)} rows={7} className={input} placeholder="Cole aqui a conversa ou os dados que o cliente mandou" />
            <button type="button" onClick={readConversation} disabled={reading || !conversation.trim()} className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl px-4 py-2.5">
              {reading ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {reading ? 'Lendo a conversa...' : 'Ler conversa com IA'}
            </button>
            {doubts.length > 0 && (
              <ul className="rounded-2xl bg-sun-100/70 border border-sun-300/50 p-3 space-y-1.5" aria-label="Dúvidas para conferir">
                {doubts.map((d) => <li key={d} className="text-xs font-semibold text-brand-950 flex gap-2"><TriangleAlert size={14} className="shrink-0 mt-0.5" />{d}</li>)}
              </ul>
            )}
          </section>

          <section className={`${card} p-5 space-y-3`}>
            <div><label htmlFor="art-name" className={label}>Nome</label><input id="art-name" value={fields.name} onChange={set('name')} className={input} /></div>
            <div><label htmlFor="art-title" className={label}>Título</label><input id="art-title" value={fields.title} onChange={set('title')} className={input} /></div>
            <div><label htmlFor="art-body" className={label}>Mensagem</label><textarea id="art-body" value={fields.body} onChange={set('body')} rows={5} className={input} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor="art-line" className={label}>Data gravada</label><input id="art-line" value={fields.line} onChange={set('line')} className={input} /></div>
              <div>
                <label htmlFor="art-size" className={label}>Tamanho (cm)</label>
                <select id="art-size" value={size} onChange={(e) => setSize(e.target.value)} className={input}>{SIZES.map((s) => <option key={s} value={s}>{s.replace('x', ' × ')}</option>)}</select>
              </div>
            </div>
            <div><label htmlFor="art-from" className={label}>Quem homenageia</label><textarea id="art-from" value={fields.from} onChange={set('from')} rows={2} className={input} /></div>
            {templateId === 'certificado' && (
              <div>
                <label htmlFor="art-signs" className={label}>Assinaturas (uma por linha)</label>
                <textarea id="art-signs" value={(fields.signatures || []).join('\n')} onChange={(e) => setFields((f) => ({ ...f, signatures: e.target.value.split('\n') }))} rows={3} className={input} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <ImagePick title="Logo" value={fields.logo} onChange={(v) => setFields((f) => ({ ...f, logo: v }))} />
              <ImagePick title="Foto" value={fields.photo} onChange={(v) => setFields((f) => ({ ...f, photo: v }))} />
            </div>
          </section>
        </div>

        <div className="space-y-5 min-w-0">
          <section className={`${card} p-5`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="font-extrabold text-brand-950">{scene.template.name} · {size.replace('x', ' × ')} cm</h2>
              <p className="text-xs text-slate-500">Fontes: {scene.template.fonts.join(', ')}</p>
            </div>
            <div className="mx-auto max-w-3xl" dangerouslySetInnerHTML={{ __html: toSvg(scene, { attrs: 'role="img" aria-label="Prévia da arte da placa" style="width:100%;height:auto;display:block"', idPrefix: 'main' }) }} />

            {issues.length > 0 && (
              <ul className="mt-4 space-y-1.5" aria-label="Conferência automática">
                {issues.map((i) => (
                  <li key={i.msg} className={`text-xs font-bold flex gap-2 ${i.level === 'erro' ? 'text-flame-600' : 'text-slate-600'}`}><TriangleAlert size={14} className="shrink-0 mt-0.5" />{i.msg}</li>
                ))}
              </ul>
            )}

            <label className="mt-4 flex items-start gap-2 text-sm font-semibold text-brand-950 cursor-pointer">
              <input type="checkbox" checked={checked} disabled={!hasContent} onChange={(e) => setChecked(e.target.checked)} className="mt-1" />
              Conferi nome, datas e cada palavra com o que o cliente mandou.
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={copyPng} disabled={!ready} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold text-sm rounded-xl px-4 py-2.5"><ClipboardCopy size={16} />Copiar imagem</button>
              <button type="button" onClick={savePng} disabled={!ready} className="flex items-center gap-2 border border-black/10 disabled:opacity-40 font-bold text-sm text-brand-950 rounded-xl px-4 py-2.5"><Download size={16} />Baixar PNG</button>
              <button type="button" onClick={saveSvg} disabled={!ready} className="flex items-center gap-2 border border-black/10 disabled:opacity-40 font-bold text-sm text-brand-950 rounded-xl px-4 py-2.5"><FileCode2 size={16} />SVG para o Corel</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">O SVG vem na medida real, sem o fundo de metal, com o logo e o texto editável. O contorno vermelho marca o limite da placa: apague antes de gravar. Instale as fontes do modelo no computador do Corel.</p>
          </section>

          <section className={`${card} p-5`}>
            <h2 className="font-extrabold text-brand-950 mb-3">Modelos</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {scenes.map((s) => (
                <button key={s.template.id} type="button" aria-pressed={s.template.id === templateId} onClick={() => setTemplateId(s.template.id)} className={`text-left rounded-2xl p-2 border-2 transition ${s.template.id === templateId ? 'border-brand-500' : 'border-transparent hover:border-black/10'}`}>
                  <span className="block pointer-events-none" dangerouslySetInnerHTML={{ __html: toSvg(s, { attrs: 'aria-hidden="true" style="width:100%;height:auto;display:block"', idPrefix: `t-${s.template.id}` }) }} />
                  <span className="block mt-2 text-xs font-extrabold text-brand-950">{s.template.name}</span>
                  <span className="block text-[11px] leading-snug text-slate-500">{s.template.desc}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
