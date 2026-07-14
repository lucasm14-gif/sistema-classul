import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check } from 'lucide-react';

const defaultMessages = [
    {
        id: 1,
        title: 'Saudação Inicial',
        text: 'Olá! Tudo bem? Como posso ajudar você hoje?'
    },
    {
        id: 2,
        title: 'Endereço',
        text: 'Rua Carlos Von Koseritiz, 63 - Apt 1 90540-031'
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

    const handleCopy = (text, id) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    const overlayStyle = {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        pointerEvents: 'auto'
    };

    const panelStyle = {
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        width: '500px',
        maxWidth: '92vw',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        animation: 'slideIn 0.3s ease-out forwards'
    };

    return createPortal(
        <div style={overlayStyle} onClick={onClose}>
            <style>
                {`
                    @keyframes slideIn {
                        from { opacity: 0; transform: translateY(-20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                `}
            </style>
            <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div style={{
                    backgroundColor: '#25D366',
                    padding: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    color: 'white'
                }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>Mensagens Rápidas</h2>
                        <p style={{ margin: 0, fontSize: '13px', opacity: 0.9 }}>Clique para copiar</p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '8px' }}
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Messages List */}
                <div style={{
                    padding: '16px',
                    flex: 1,
                    overflowY: 'auto',
                    backgroundColor: '#f0f2f5',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                }}>
                    {defaultMessages.map((msg) => (
                        <div
                            key={msg.id}
                            style={{
                                backgroundColor: 'white',
                                borderRadius: '12px',
                                padding: '16px',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                display: 'flex',
                                gap: '12px',
                                alignItems: 'flex-start',
                                transition: 'transform 0.2s',
                                cursor: 'pointer'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                            onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                        >
                            <div style={{ flex: 1 }}>
                                <h3 style={{
                                    margin: '0 0 8px 0',
                                    fontSize: '14px',
                                    fontWeight: 'bold',
                                    color: '#25D366'
                                }}>
                                    {msg.title}
                                </h3>
                                <p style={{
                                    margin: 0,
                                    fontSize: '14px',
                                    color: '#667781',
                                    lineHeight: '1.5'
                                }}>
                                    {msg.text}
                                </p>
                            </div>
                            <button
                                onClick={() => handleCopy(msg.text, msg.id)}
                                style={{
                                    padding: '10px',
                                    backgroundColor: copiedId === msg.id ? '#25D366' : '#f0f2f5',
                                    color: copiedId === msg.id ? 'white' : '#667781',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s',
                                    minWidth: '40px'
                                }}
                                title={copiedId === msg.id ? 'Copiado!' : 'Copiar mensagem'}
                            >
                                {copiedId === msg.id ? <Check size={18} /> : <Copy size={18} />}
                            </button>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px',
                    borderTop: '1px solid #eee',
                    backgroundColor: '#fff',
                    textAlign: 'center'
                }}>
                    <p style={{
                        margin: 0,
                        fontSize: '12px',
                        color: '#999'
                    }}>
                        💡 Dica: Após copiar, cole no campo de mensagem do WhatsApp
                    </p>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default QuickMessages;
