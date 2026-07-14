import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { Send, X, LoaderCircle } from 'lucide-react';
import { createOrder } from '../services/classul';

const CASE_COLORS = ['Preto', 'Azul', 'Vermelho'];
const PRODUCT_TYPES = ['Maquina', 'Jota', 'Sublimação'];

const CASE_COLOR_STYLES = {
    Preto: {
        backgroundColor: '#111111',
        borderColor: '#111111',
        color: '#ffffff'
    },
    Azul: {
        backgroundColor: '#dbeafe',
        borderColor: '#60a5fa',
        color: '#1d4ed8'
    },
    Vermelho: {
        backgroundColor: '#fee2e2',
        borderColor: '#f87171',
        color: '#b91c1c'
    }
};

const OrderModal = ({ contactData, onClose }) => {
    const [name, setName] = useState(contactData.name || '');
    const [description, setDescription] = useState('');
    const [phone, setPhone] = useState(contactData.phone || '');
    const [dueDate, setDueDate] = useState('');
    const [caseColor, setCaseColor] = useState('');
    const [productType, setProductType] = useState('Maquina');
    const [value, setValue] = useState('');
    const [isSending, setIsSending] = useState(false);

    const handleSubmit = async () => {
        if (!name.trim()) {
            alert('Por favor, preencha o nome do contato.');
            return;
        }

        setIsSending(true);
        try {
            const order = await createOrder({
                customer_name: name,
                description: description || null,
                phone: phone || null,
                due_date: dueDate || null,
                case_color: caseColor || null,
                product_type: productType,
                value: value || null
            });

            // Notificação de sucesso com o número do pedido
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #064e3b 0%, #059669 100%);
                color: white;
                padding: 16px 24px;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                z-index: 2147483648;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                font-size: 14px;
                font-weight: 500;
                animation: slideInRight 0.3s ease-out;
                border: 1px solid rgba(255,255,255,0.15);
            `;
            notification.textContent = `✓ Pedido ${order.order_number} criado no sistema Classul!`;
            document.body.appendChild(notification);

            setTimeout(() => {
                notification.remove();
            }, 4000);

            onClose();
        } catch (error) {
            console.error('Falha ao criar pedido:', error);
            alert(`Erro ao criar pedido: ${error.message}`);
        } finally {
            setIsSending(false);
        }
    };

    const overlayStyle = {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        pointerEvents: 'auto'
    };

    const modalStyle = {
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        width: '760px',
        maxWidth: '96vw',
        maxHeight: '92vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        animation: 'zoomIn 0.2s ease-out forwards'
    };

    const fieldCardStyle = {
        backgroundColor: 'white',
        padding: '16px',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    };

    const labelStyle = {
        display: 'block',
        fontSize: '12px',
        fontWeight: 'bold',
        color: '#666',
        marginBottom: '8px',
        textTransform: 'uppercase'
    };

    const inputStyle = {
        width: '100%',
        padding: '10px',
        border: '1px solid #ddd',
        borderRadius: '8px',
        outline: 'none',
        fontSize: '14px',
        boxSizing: 'border-box'
    };

    const choiceGroupStyle = {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '8px'
    };

    const getChoiceButtonStyle = (option, isSelected, selectedStyles = {}) => {
        const activeStyle = selectedStyles[option] || {
            backgroundColor: '#059669',
            borderColor: '#059669',
            color: '#ffffff'
        };

        return {
            minHeight: '38px',
            padding: '8px 10px',
            border: isSelected ? `2px solid ${activeStyle.borderColor}` : '1px solid #ddd',
            borderRadius: '8px',
            backgroundColor: isSelected ? activeStyle.backgroundColor : '#ffffff',
            color: isSelected ? activeStyle.color : '#333333',
            cursor: isSending ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: isSelected ? '700' : '500',
            opacity: isSending ? 0.6 : 1
        };
    };

    const renderChoiceButtons = (options, selectedValue, onSelect, selectedStyles) => (
        <div style={choiceGroupStyle}>
            {options.map((option) => (
                <button
                    key={option}
                    type="button"
                    onClick={() => onSelect(option)}
                    disabled={isSending}
                    style={getChoiceButtonStyle(option, selectedValue === option, selectedStyles)}
                >
                    {option}
                </button>
            ))}
        </div>
    );

    return ReactDOM.createPortal(
        <div style={overlayStyle} onClick={onClose}>
            <style>
                {`
                    @keyframes zoomIn {
                        from { transform: scale(0.9); opacity: 0; }
                        to { transform: scale(1); opacity: 1; }
                    }
                    @keyframes slideInRight {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                    .animate-spin {
                        animation: spin 1s linear infinite;
                    }
                    .classul-form-grid {
                        padding: 20px;
                        flex: 1;
                        overflow-y: auto;
                        background-color: #f0f2f5;
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 14px;
                    }
                    .classul-form-span {
                        grid-column: 1 / -1;
                    }
                    @media (max-width: 680px) {
                        .classul-form-grid {
                            grid-template-columns: 1fr;
                            padding: 16px;
                        }
                    }
                `}
            </style>
            <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div style={{
                    backgroundColor: '#0f172a',
                    padding: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    color: 'white'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {contactData.avatar ? (
                            <img
                                src={contactData.avatar}
                                style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '50%',
                                    border: '2px solid rgba(255,255,255,0.4)',
                                    objectFit: 'cover'
                                }}
                            />
                        ) : (
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                backgroundColor: '#059669',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '18px',
                                fontWeight: 'bold'
                            }}>
                                {name.charAt(0).toUpperCase()}
                            </div>
                        )}
                        <div>
                            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Novo Pedido Classul</h2>
                            <p style={{ margin: 0, fontSize: '12px', opacity: 0.9 }}>O pedido entra na coluna "Novo Pedido" do quadro</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            padding: '8px'
                        }}
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Form */}
                <div className="classul-form-grid">
                    <div style={fieldCardStyle}>
                        <label style={labelStyle}>
                            Nome do Cliente *
                        </label>
                        <input
                            type="text"
                            style={inputStyle}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Nome do cliente"
                            disabled={isSending}
                        />
                    </div>

                    <div style={fieldCardStyle}>
                        <label style={labelStyle}>
                            Telefone (WhatsApp)
                        </label>
                        <input
                            type="text"
                            style={inputStyle}
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="5511999999999"
                            disabled={isSending}
                        />
                    </div>

                    <div style={fieldCardStyle}>
                        <label style={labelStyle}>
                            Data de Entrega
                        </label>
                        <input
                            type="date"
                            style={inputStyle}
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            disabled={isSending}
                        />
                    </div>

                    <div style={fieldCardStyle}>
                        <label style={labelStyle}>
                            Estojo
                        </label>
                        {!caseColor && (
                            <div style={{
                                fontSize: '12px',
                                color: '#999',
                                marginBottom: '8px'
                            }}>
                                Sem estojo selecionado
                            </div>
                        )}
                        {renderChoiceButtons(CASE_COLORS, caseColor, setCaseColor, CASE_COLOR_STYLES)}
                    </div>

                    <div style={fieldCardStyle}>
                        <label style={labelStyle}>
                            Tipo
                        </label>
                        {renderChoiceButtons(PRODUCT_TYPES, productType, setProductType)}
                    </div>

                    <div style={fieldCardStyle}>
                        <label style={labelStyle}>
                            Valor
                        </label>
                        <input
                            type="text"
                            inputMode="decimal"
                            style={inputStyle}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder="Digite o valor"
                            disabled={isSending}
                        />
                    </div>

                    <div className="classul-form-span" style={{ ...fieldCardStyle, flex: 1 }}>
                        <label style={labelStyle}>
                            Descrição
                        </label>
                        <textarea
                            style={{
                                width: '100%',
                                height: '100px',
                                border: '1px solid #ddd',
                                borderRadius: '8px',
                                padding: '12px',
                                resize: 'none',
                                outline: 'none',
                                fontSize: '14px',
                                lineHeight: '1.5',
                                boxSizing: 'border-box'
                            }}
                            placeholder="Detalhes do pedido..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={isSending}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '20px',
                    borderTop: '1px solid #eee',
                    backgroundColor: '#fff',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px'
                }}>
                    <button
                        onClick={onClose}
                        disabled={isSending}
                        style={{
                            padding: '10px 20px',
                            color: '#666',
                            background: '#f5f5f5',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: isSending ? 'not-allowed' : 'pointer',
                            fontWeight: '500',
                            opacity: isSending ? 0.5 : 1
                        }}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSending}
                        style={{
                            padding: '10px 24px',
                            backgroundColor: '#059669',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: isSending ? 'not-allowed' : 'pointer',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
                            opacity: isSending ? 0.7 : 1
                        }}
                    >
                        {isSending ? <LoaderCircle size={18} className="animate-spin" /> : <Send size={18} />}
                        {isSending ? 'Criando...' : 'Criar Pedido'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default OrderModal;
