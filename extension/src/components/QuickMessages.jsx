import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Search, CornerDownLeft } from 'lucide-react';
import { getExtensionConfig } from '../services/classul';
import { insertIntoComposer, isWhatsAppDark } from '../utils/dom';
import { toast } from '../utils/toast';

// Reserva: usada só enquanto o sistema não responde (primeira abertura sem
// internet, ou extensão ainda não configurada). A fonte real é a aba Extensão.
const fallbackMessages = [
    {
        id: 1,
        title: 'Saudação Inicial',
        text: 'Olá! Tudo bem? Como posso ajudar você hoje?'
    },
    {
        id: 2,
        title: 'Endereço',
        text: 'Rua Carlos Von Koseritiz, 63 - Bairro São João - Conj 1 -  90540-031'
    },
    {
        id: 3,
        title: 'Avaliação Google',
        text: 'Queremos saber como foi a sua experiência com a Classul! Sua opinião é muito importante para nós.\n\nSe puder, deixe uma avaliação no Google. Isso nos ajuda a continuar oferecendo um atendimento de qualidade! 🙌\n\nÉ só clicar no link abaixo e compartilhar seu feedback:\n🔗 https://g.page/r/CdrHqDugZPp5EBE/review\n\nAgradecemos muito pelo seu tempo e confiança!'
    },
    {
        id: 4,
        title: 'Horário de Atendimento',
        text: 'Nosso horário de atendimento é de segunda a sexta, das 9h às 12h / 13h30 até 18h.\nFinais de semana e feriados não atendemos.'
    },
    {
        id: 5,
        title: 'Dados Cadastrais',
        text: `📋 DADOS CADASTRAIS

Razão Social: CLASSUL IND. E COM. DE PLACAS E BRINDES LTDA - ME
Nome Fantasia: BRINDIDÉIAS
CNPJ: 18.605.962/0001-30

Insc. Estadual: 096/3547283
Insc. Municipal: 559.644.2.7

Endereço: Rua Carlos Von Koseritiz, Nº 63
Complemento: Apt 1
Cidade: PORTO ALEGRE - RS
CEP: 90540-031

Fones: (51) 3062.3965 - 3225.3965 - 3013.3965
WebSite: WWW.CLASSUL.COM.BR
E-mails: CLASSUL@CLASSUL.COM.BR - CLASSULRS@GMAIL.COM
WhatsApp: (51) 98927.4761

💰 DADOS BANCÁRIOS

PIX / CHAVE Bco Itaú: CNPJ ➜ 18.605.962/0001-30

BANCO: 341 - ITAÚ
AGÊNCIA: 6201
CONTA: 50305-6

BANCO: 041 - BANRISUL
AGÊNCIA: 0062
CONTA: 06061233.0-8`
    },
    {
        id: 6,
        title: 'PIX CNPJ',
        text: 'Pix CNPJ: 18605962000130'
    },
    {
        id: 7,
        title: 'Código de Coleta',
        text: 'Ao solicitar a coleta, informe o código: CL-'
    }
];

const QuickMessages = ({ onClose }) => {
    const [copiedId, setCopiedId] = useState(null);
    const [messages, setMessages] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [query, setQuery] = useState('');
    const [dark] = useState(isWhatsAppDark);

    // Abre instantâneo com a cópia local e troca pela versão fresca do sistema
    // em seguida — é isso que faz a edição feita no sistema aparecer na hora.
    useEffect(() => {
        let alive = true;
        getExtensionConfig()
            .then((cfg) => alive && cfg.quick_messages?.length && setMessages((m) => m || cfg.quick_messages))
            .catch(() => {});
        getExtensionConfig({ refresh: true })
            .then((cfg) => alive && setMessages(cfg.quick_messages?.length ? cfg.quick_messages : fallbackMessages))
            .catch((err) => {
                if (!alive) return;
                setLoadError(err.message);
                setMessages((m) => m || fallbackMessages);
            });
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        return () => {
            alive = false;
            document.removeEventListener('keydown', onKey);
        };
    }, []); // eslint-disable-line

    const shown = (messages || []).filter((m) =>
        !query ? true : (m.title + ' ' + m.text).toLowerCase().includes(query.toLowerCase())
    );

    // Clique na mensagem: vai para o campo de mensagem da conversa (sem enviar).
    const use = async (msg) => {
        const r = await insertIntoComposer(msg.text);
        toast(r === 'inserted' ? `"${msg.title}" no campo de mensagem — aperte Enter` : 'Copiada — cole na conversa');
        onClose();
    };

    const copy = (e, msg) => {
        e.stopPropagation();
        navigator.clipboard.writeText(msg.text).then(() => {
            setCopiedId(msg.id);
            setTimeout(() => setCopiedId(null), 1500);
        });
    };

    return createPortal(
        <div
            onMouseDown={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 2147483646, background: 'rgba(11,20,26,.35)',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '9vh', pointerEvents: 'auto'
            }}
        >
            <div
                className={'clp' + (dark ? ' dark' : '')}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                    position: 'relative', height: 'auto', maxHeight: '78vh', width: 520, maxWidth: '94vw',
                    borderRadius: 16, border: '1px solid var(--line)', overflow: 'hidden'
                }}
            >
                <div className="clp-head" style={{ gap: 8 }}>
                    <div className="clp-search" style={{ flex: 1 }}>
                        <Search size={15} />
                        <input
                            autoFocus
                            className="clp-input"
                            placeholder="Mensagens rápidas — digite para filtrar"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && shown[0]) use(shown[0]);
                            }}
                        />
                    </div>
                    <button className="clp-icon" title="Fechar (Esc)" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
                <div className="clp-body" style={{ gap: 6 }}>
                    {loadError && (
                        <div className="clp-alert">Mostrando a cópia salva no aparelho — o sistema não respondeu.</div>
                    )}
                    {!messages && <div className="clp-skel" style={{ height: 60 }} />}
                    {shown.map((msg, i) => (
                        <button key={msg.id} className="clp-order" style={{ gap: 4 }} onClick={() => use(msg)}>
                            <div className="clp-row between">
                                <span className="clp-title" style={{ color: 'var(--brand-ink)' }}>{msg.title}</span>
                                <span className="clp-row" style={{ gap: 4 }}>
                                    {i === 0 && query && (
                                        <span className="clp-pill"><CornerDownLeft size={11} /> Enter</span>
                                    )}
                                    <span
                                        role="button"
                                        className="clp-icon"
                                        style={{ width: 28, height: 28 }}
                                        title="Só copiar"
                                        onClick={(e) => copy(e, msg)}
                                    >
                                        {copiedId === msg.id ? <Check size={15} color="var(--brand)" /> : <Copy size={15} />}
                                    </span>
                                </span>
                            </div>
                            <div className="clp-desc" style={{ WebkitLineClamp: 3 }}>{msg.text}</div>
                        </button>
                    ))}
                    {messages && !shown.length && <div className="clp-empty">Nenhuma mensagem com “{query}”.</div>}
                </div>
                <div className="clp-foot clp-muted" style={{ justifyContent: 'center' }}>
                    Clique para pôr no campo de mensagem · nada é enviado sem o seu Enter
                </div>
            </div>
        </div>,
        document.body
    );
};

export default QuickMessages;
