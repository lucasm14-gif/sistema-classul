// Integração com o sistema Classul via background service worker
// (o background faz o fetch para evitar CORS e guarda a configuração).

export const createOrder = async (orderData) => {
    const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { action: 'createOrder', data: orderData },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            }
        );
    });

    if (!response || !response.success) {
        throw new Error(response?.error || 'Erro desconhecido ao criar pedido.');
    }

    return response.data;
};

// Conteúdo mantido no sistema (mensagens rápidas, fotos e catálogo).
// O background cuida do cache e da atualização em segundo plano.
export const getExtensionConfig = async ({ refresh = false } = {}) => {
    const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getExtensionConfig', refresh }, (res) => {
            if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
                resolve(res);
            }
        });
    });

    if (!response || !response.success) {
        throw new Error(response?.error || 'Não foi possível buscar as informações do sistema.');
    }

    return response.data;
};
