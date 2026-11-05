import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileImage, Layers, MessageCircle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { openWhatsApp } from '../whatsapp';
import { useToast } from './Toast';

const when = (iso) => new Date(iso).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
});

function Status({ plate }) {
  if (plate.image_error) return <span className="text-xs font-bold text-flame-700" title={plate.image_error}>Imagem não enviada</span>;
  if (plate.image_sent_at) return <span className="text-xs font-bold text-brand-700">Imagem enviada na conversa</span>;
  if (plate.phone) return <span className="text-xs font-bold text-slate-500">Mensagem recebida</span>;
  return <span className="text-xs font-bold text-slate-400">Cliente ainda não enviou a mensagem</span>;
}

function PlateCard({ plate, onDownload }) {
  const d = plate.data;
  return (
    <article className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden flex flex-col">
      <img src={`/api/plates/${plate.token}/image.jpg`} alt={`Placa de ${d.name || 'cliente'}`} loading="lazy" className="w-full aspect-[3/2] object-contain bg-black/[0.04]" />
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <p className="font-extrabold text-brand-950 break-words">{d.name || 'Sem nome'}</p>
        <p className="text-xs font-semibold text-slate-500">
          #{String(plate.id).padStart(4, '0')} · {String(d.size || '').replace('x', '×')} cm · estojo {d.color} · {when(plate.created_at)}
        </p>
        {plate.push_name && <p className="text-xs font-semibold text-slate-500">{plate.push_name}</p>}
        <Status plate={plate} />
        {d.overflow && <span className="text-xs font-bold text-flame-700">Texto maior que a placa: conferir a arte</span>}
        <div className="flex flex-wrap gap-2 mt-auto pt-3">
          <button type="button" onClick={() => onDownload(plate.id, 'svg')} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-xs font-bold px-3 py-2 hover:bg-brand-700">
            <Download size={14} /> SVG para o Corel
          </button>
          <button type="button" onClick={() => onDownload(plate.id, 'jpg')} className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 text-xs font-bold px-3 py-2 hover:bg-black/[0.04]">
            <FileImage size={14} /> JPG
          </button>
          {plate.has_logo && (
            <button type="button" onClick={() => onDownload(plate.id, 'logo')} className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 text-xs font-bold px-3 py-2 hover:bg-black/[0.04]">
              <FileImage size={14} /> Logo original
            </button>
          )}
          {plate.phone && (
            <button type="button" onClick={() => openWhatsApp(plate.phone)} className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 text-xs font-bold px-3 py-2 hover:bg-black/[0.04]">
              <MessageCircle size={14} /> Conversa
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function SitePlates({ onAuthError }) {
  const toast = useToast();
  const [state, setState] = useState({ plates: null, send_image: true });

  const fail = useCallback((err) => {
    if (!onAuthError(err)) toast(err.message, 'error');
  }, [onAuthError, toast]);

  const load = useCallback(() => api.getPlates().then(setState).catch(fail), [fail]);
  useEffect(() => { load(); }, [load]);

  const toggle = () => {
    const send_image = !state.send_image;
    api.savePlatesSettings({ send_image }).then(() => setState((s) => ({ ...s, send_image }))).catch(fail);
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-extrabold text-brand-950 flex items-center gap-2"><Layers size={20} /> Placas do site</h1>
          <p className="text-sm font-semibold text-slate-500">Cada placa montada na landing page, com a imagem e o vetor para o CorelDRAW.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={state.send_image} onChange={toggle} /> Responder com a imagem no WhatsApp
          </label>
          <button type="button" onClick={load} aria-label="Atualizar" className="p-2 rounded-xl border border-black/10 hover:bg-black/[0.04]"><RefreshCw size={15} /></button>
        </div>
      </div>
      {state.plates && !state.plates.length && (
        <p className="bg-white rounded-3xl border border-black/5 p-8 text-center text-sm font-semibold text-slate-500">Nenhuma placa montada ainda.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {state.plates?.map((p) => (
          <PlateCard key={p.id} plate={p} onDownload={(id, kind) => api.downloadPlateFile(id, kind).catch(fail)} />
        ))}
      </div>
    </div>
  );
}
