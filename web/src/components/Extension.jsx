import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MessageSquareText,
  Images,
  Package,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  Upload,
  LoaderCircle,
  Ruler,
  TriangleAlert
} from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';

const card = 'bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden';
const label = 'block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2';
const input =
  'w-full bg-black/[0.03] border border-black/5 rounded-xl px-3.5 py-2.5 text-sm font-medium text-brand-950 outline-none focus:border-brand-400 focus:bg-white transition-colors';

const SECTIONS = [
  { id: 'mensagens', label: 'Mensagens rápidas', icon: MessageSquareText },
  { id: 'fotos', label: 'Fotos', icon: Images },
  { id: 'catalogo', label: 'Catálogo', icon: Package }
];

/* ---------------- Mensagens rápidas ---------------- */

function MessageRow({ message, onSave, onDelete, onMove, first, last }) {
  const [title, setTitle] = useState(message.title);
  const [body, setBody] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const dirty = title !== message.title || body !== message.body;

  useEffect(() => {
    setTitle(message.title);
    setBody(message.body);
  }, [message.id, message.title, message.body]);

  const save = async () => {
    setSaving(true);
    await onSave(message.id, { title, body });
    setSaving(false);
  };

  return (
    <div className="px-5 py-4 space-y-2">
      <div className="flex items-center gap-2">
        <input className={`${input} flex-1 font-bold`} value={title} onChange={(e) => setTitle(e.target.value)} />
        <button
          onClick={() => onMove(message.id, -1)}
          disabled={first}
          title="Subir"
          className="p-2 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-black/5 disabled:opacity-25 transition-colors"
        >
          <ChevronUp size={16} />
        </button>
        <button
          onClick={() => onMove(message.id, 1)}
          disabled={last}
          title="Descer"
          className="p-2 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-black/5 disabled:opacity-25 transition-colors"
        >
          <ChevronDown size={16} />
        </button>
        <button
          onClick={() => onDelete(message)}
          title="Excluir"
          className="p-2 rounded-lg text-slate-400 hover:text-flame-600 hover:bg-flame-50 transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <textarea
        className={`${input} h-28 resize-y font-mono text-xs`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {dirty && (
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs font-extrabold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-full transition-colors disabled:opacity-60"
        >
          {saving ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
          Salvar
        </button>
      )}
    </div>
  );
}

function QuickMessagesSection({ onAuthError }) {
  const [messages, setMessages] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setMessages(await api.listQuickMessages());
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    try {
      const created = await api.createQuickMessage({ title: 'Nova mensagem', body: 'Escreva o texto aqui.' });
      setMessages((prev) => [...prev, created]);
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const save = async (id, data) => {
    try {
      const saved = await api.updateQuickMessage(id, data);
      setMessages((prev) => prev.map((m) => (m.id === id ? saved : m)));
      toast('Mensagem salva — já vale na extensão.', 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const remove = async (message) => {
    if (!confirm(`Excluir a mensagem "${message.title}"?`)) return;
    try {
      await api.deleteQuickMessage(message.id);
      setMessages((prev) => prev.filter((m) => m.id !== message.id));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const move = async (id, delta) => {
    const index = messages.findIndex((m) => m.id === id);
    const target = index + delta;
    if (target < 0 || target >= messages.length) return;
    const next = [...messages];
    [next[index], next[target]] = [next[target], next[index]];
    setMessages(next);
    try {
      await api.reorderQuickMessages(next.map((m) => m.id));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
      load();
    }
  };

  if (!messages) return <p className="text-sm font-medium text-slate-400">Carregando…</p>;

  return (
    <div className={card}>
      <div className="px-5 py-4 border-b border-black/5 flex items-center gap-3">
        <div className="mr-auto">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Mensagens rápidas</h3>
          <p className="text-[11px] font-medium text-slate-400">
            São os textos de copiar e colar que aparecem no botão da extensão, nesta ordem.
          </p>
        </div>
        <button
          onClick={add}
          className="flex items-center gap-1.5 text-xs font-extrabold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2.5 rounded-full transition-colors shrink-0"
        >
          <Plus size={14} /> Nova
        </button>
      </div>
      {messages.length === 0 ? (
        <p className="px-5 py-10 text-sm font-medium text-slate-400 text-center">Nenhuma mensagem cadastrada.</p>
      ) : (
        <div className="divide-y divide-black/5">
          {messages.map((m, i) => (
            <MessageRow
              key={m.id}
              message={m}
              onSave={save}
              onDelete={remove}
              onMove={move}
              first={i === 0}
              last={i === messages.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Fotos ---------------- */

function PhotoSet({ set, onUpload, onDeletePhoto, onDeleteSet, uploading }) {
  const fileRef = useRef(null);
  return (
    <div className={card}>
      <div className="px-5 py-4 border-b border-black/5 flex items-center gap-3">
        <h3 className="font-extrabold tracking-tight text-brand-950 text-sm mr-auto">{set.name}</h3>
        <span className="text-[11px] font-bold text-slate-400">
          {set.photos.length} foto{set.photos.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:text-brand-900 disabled:opacity-50 transition-colors"
        >
          {uploading ? <LoaderCircle size={13} className="animate-spin" /> : <Upload size={13} />}
          Enviar foto
        </button>
        <button
          onClick={() => onDeleteSet(set)}
          title="Excluir conjunto"
          className="p-2 rounded-lg text-slate-400 hover:text-flame-600 hover:bg-flame-50 transition-colors"
        >
          <Trash2 size={15} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUpload(set, file);
          }}
        />
      </div>
      {set.photos.length === 0 ? (
        <p className="px-5 py-8 text-sm font-medium text-slate-400 text-center">
          Nenhuma foto ainda. Envie a primeira.
        </p>
      ) : (
        <div className="p-5 grid grid-cols-3 sm:grid-cols-5 gap-3">
          {set.photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <img
                src={photo.url}
                alt={photo.name}
                className="w-full aspect-square object-cover rounded-xl border border-black/5"
              />
              <button
                onClick={() => onDeletePhoto(set, photo)}
                title="Excluir foto"
                className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-white/90 text-slate-500 hover:text-flame-600 opacity-0 group-hover:opacity-100 transition-opacity shadow"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PhotosSection({ onAuthError }) {
  const [sets, setSets] = useState(null);
  const [drive, setDrive] = useState(null);
  const [uploadingSet, setUploadingSet] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([api.listPhotoSets(), api.googleStatus()]);
      setSets(list);
      setDrive(status);
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const addSet = async () => {
    const name = prompt('Nome do conjunto de fotos (ex: Placa de Homenagem):');
    if (!name?.trim()) return;
    try {
      const created = await api.createPhotoSet(name.trim());
      setSets((prev) => [...prev, created]);
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const upload = async (set, file) => {
    setUploadingSet(set.id);
    try {
      const { uploadUrl } = await api.createPhotoSession(set.id, {
        name: file.name,
        mimeType: file.type || 'image/jpeg',
        size: file.size
      });
      const up = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: file
      });
      if (!up.ok) throw new Error(`Falha no envio para o Google Drive (${up.status}).`);
      const uploaded = await up.json();
      const photo = await api.registerPhoto(set.id, uploaded.id);
      setSets((prev) => prev.map((s) => (s.id === set.id ? { ...s, photos: [...s.photos, photo] } : s)));
      toast('Foto enviada — a extensão já vai usar.', 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setUploadingSet(null);
    }
  };

  const removePhoto = async (set, photo) => {
    if (!confirm('Excluir esta foto?')) return;
    try {
      await api.deletePhoto(photo.id);
      setSets((prev) =>
        prev.map((s) => (s.id === set.id ? { ...s, photos: s.photos.filter((p) => p.id !== photo.id) } : s))
      );
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const removeSet = async (set) => {
    if (!confirm(`Excluir o conjunto "${set.name}" e as ${set.photos.length} foto(s) dele?`)) return;
    try {
      await api.deletePhotoSet(set.id);
      setSets((prev) => prev.filter((s) => s.id !== set.id));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  if (!sets) return <p className="text-sm font-medium text-slate-400">Carregando…</p>;

  return (
    <div className="space-y-5">
      {drive && !drive.connected && (
        <div className="flex items-start gap-3 bg-sun-100/60 border border-sun-400/40 rounded-2xl px-5 py-4">
          <TriangleAlert size={16} className="text-yellow-700 shrink-0 mt-0.5" />
          <p className="text-xs font-semibold text-yellow-800 leading-relaxed">
            O Google Drive não está conectado, e é nele que as fotos ficam guardadas. Conecte em{' '}
            <strong>Configurações → Google Drive</strong> antes de enviar imagens.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="mr-auto">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Conjuntos de fotos</h3>
          <p className="text-[11px] font-medium text-slate-400">
            Cada conjunto vira um botão de envio na extensão. As fotos vão na ordem em que foram enviadas.
          </p>
        </div>
        <button
          onClick={addSet}
          className="flex items-center gap-1.5 text-xs font-extrabold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2.5 rounded-full transition-colors shrink-0"
        >
          <Plus size={14} /> Novo conjunto
        </button>
      </div>

      {sets.length === 0 ? (
        <div className="text-center py-16 bg-black/[0.02] border border-dashed border-black/10 rounded-3xl">
          <p className="text-sm font-bold text-slate-400 mb-1">Nenhum conjunto ainda.</p>
          <p className="text-xs font-medium text-slate-400">
            Crie um conjunto (ex: "Placa de Homenagem") e envie as fotos dele.
          </p>
        </div>
      ) : (
        sets.map((set) => (
          <PhotoSet
            key={set.id}
            set={set}
            uploading={uploadingSet === set.id}
            onUpload={upload}
            onDeletePhoto={removePhoto}
            onDeleteSet={removeSet}
          />
        ))
      )}
    </div>
  );
}

/* ---------------- Catálogo ---------------- */

function CatalogSection({ onAuthError }) {
  const [products, setProducts] = useState(null);
  const [name, setName] = useState('');
  const [shortLabel, setShortLabel] = useState('');
  const [hasSize, setHasSize] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setProducts(await api.listCatalog());
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    try {
      const created = await api.createCatalogProduct({
        name: name.trim(),
        short_label: shortLabel.trim() || name.trim(),
        has_size: hasSize
      });
      setProducts((prev) => [...prev, created]);
      setName('');
      setShortLabel('');
      setHasSize(false);
      toast('Produto criado — já aparece no pedido e na extensão.', 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const toggleSize = async (product) => {
    try {
      const saved = await api.updateCatalogProduct(product.id, { has_size: !product.has_size });
      setProducts((prev) => prev.map((p) => (p.id === product.id ? saved : p)));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const remove = async (product) => {
    if (!confirm(`Remover "${product.name}" da lista? Pedidos antigos continuam com o nome dele.`)) return;
    try {
      await api.deleteCatalogProduct(product.id);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  if (!products) return <p className="text-sm font-medium text-slate-400">Carregando…</p>;

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="px-5 py-4 border-b border-black/5">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Produtos</h3>
          <p className="text-[11px] font-medium text-slate-400">
            A lista que aparece no pedido, no sistema e na extensão. "Tem tamanho" mostra a tabela de medidas de placa.
          </p>
        </div>
        <div className="divide-y divide-black/5">
          {products.map((p) => (
            <div key={p.id} className="px-5 py-3 flex items-center gap-3 text-sm">
              <span className="flex-1 min-w-0 truncate font-bold text-brand-950">
                {p.name}
                {p.is_case === 1 && (
                  <span className="ml-2 text-[10px] font-extrabold uppercase bg-sun-100 text-yellow-800 px-2 py-0.5 rounded-full">
                    sem placa
                  </span>
                )}
              </span>
              <span className="text-[11px] font-bold text-slate-400 shrink-0 hidden sm:inline">{p.short_label}</span>
              <button
                onClick={() => toggleSize(p)}
                title="Usa a tabela de tamanhos de placa?"
                className={`flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-1 rounded-full transition-colors shrink-0 ${
                  p.has_size === 1
                    ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                    : 'bg-black/[0.05] text-slate-400 hover:bg-black/10'
                }`}
              >
                <Ruler size={11} /> {p.has_size === 1 ? 'tem tamanho' : 'sem tamanho'}
              </button>
              <button
                onClick={() => remove(p)}
                title="Remover da lista"
                className="p-2 rounded-lg text-slate-400 hover:text-flame-600 hover:bg-flame-50 transition-colors shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="font-extrabold tracking-tight text-brand-950 text-sm mb-4">Novo produto</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Nome</label>
            <input
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Chaveiro personalizado"
            />
          </div>
          <div>
            <label className={label}>Nome curto (card do quadro)</label>
            <input
              className={input}
              value={shortLabel}
              onChange={(e) => setShortLabel(e.target.value)}
              placeholder="Ex: Chaveiro"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => setHasSize((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-full border-2 transition-all ${
              hasSize
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-slate-500 border-slate-200 hover:border-brand-300'
            }`}
          >
            <Ruler size={13} /> Usa tamanho de placa
          </button>
          <button
            onClick={add}
            disabled={!name.trim()}
            className="ml-auto flex items-center gap-1.5 text-xs font-extrabold text-white bg-brand-600 hover:bg-brand-700 px-5 py-2.5 rounded-full transition-colors disabled:opacity-40"
          >
            <Plus size={14} /> Adicionar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Aba ---------------- */

export default function Extension({ onAuthError }) {
  const [section, setSection] = useState('mensagens');

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 overflow-y-auto h-full animate-fade-up">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Extensão do WhatsApp</h2>
        <p className="text-xs font-medium text-slate-400">
          O que você editar aqui chega na extensão sozinho — sem recarregar nada. Ela busca ao abrir o painel e
          confere de novo a cada minuto.
        </p>
      </div>

      <nav className="flex items-center gap-1 bg-black/[0.04] rounded-full p-1 w-fit">
        {SECTIONS.map(({ id, label: text, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all ${
              section === id ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-brand-900'
            }`}
          >
            <Icon size={15} strokeWidth={2.5} />
            {text}
          </button>
        ))}
      </nav>

      {section === 'mensagens' && <QuickMessagesSection onAuthError={onAuthError} />}
      {section === 'fotos' && <PhotosSection onAuthError={onAuthError} />}
      {section === 'catalogo' && <CatalogSection onAuthError={onAuthError} />}
    </div>
  );
}
