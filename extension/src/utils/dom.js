// Helper to wait for elements (WhatsApp loads dynamically)
export const waitForElement = (selector, timeout = 10000) => {
    return new Promise((resolve) => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver((mutations) => {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector));
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
};

export const getActiveChatName = () => {
    // Strategy 1: Look for the specific header in the main panel
    const mainHeader = document.querySelector('#main header');
    if (mainHeader) {
        // Look for the title info (usually the text inside a specific span)
        // WhatsApp Web usually puts the name in a generic span under the header info
        const titleSpan = mainHeader.querySelector('div[role="button"] > div > span[dir="auto"]');
        if (titleSpan) return titleSpan.innerText;

        // Fallback: Look for the biggest text in the header
        const allSpans = Array.from(mainHeader.querySelectorAll('span[dir="auto"]'));
        // The contact name is usually the first one or the one with the largest font/most importance
        if (allSpans.length > 0) return allSpans[0].innerText;
    }

    // Strategy 2: If we can't find #main, look for any header with a profile picture adjacent
    const headers = document.querySelectorAll('header');
    for (let header of headers) {
        if (header.closest('#side')) continue; // Skip sidebar header

        const titleCandidate = header.querySelector('span[title]');
        if (titleCandidate) return titleCandidate.title;
    }

    return "Desconhecido";
};

export const getActiveChatAvatar = () => {
    const header = document.querySelector('#main header');
    if (!header) return null;

    const img = header.querySelector('img');
    if (img) return img.src;

    return null;
};

// Helper for async delays
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const getActiveChatPhone = () => {
    // Strategy 1: Check if the title itself is a phone number (Unsaved contacts)
    const name = getActiveChatName();
    const cleanName = name.replace(/\D/g, '');
    if (cleanName.length >= 10 && cleanName.length <= 15) {
        return cleanName;
    }

    // Strategy 2: Extract from Avatar URL (Saved contacts often have the ID in the URL)
    const avatar = getActiveChatAvatar();
    if (avatar) {
        const uMatch = avatar.match(/u=(\d+)/);
        if (uMatch && uMatch[1]) return uMatch[1];

        const ppsMatch = avatar.match(/pps\/user\/(\d+)/);
        if (ppsMatch && ppsMatch[1]) return ppsMatch[1];
    }

    return null;
};

export const scrapePhoneFromProfile = async () => {
    // 1. Click Header to open Profile
    const headerTitle = document.querySelector('#main header div[role="button"]');
    if (!headerTitle) return null;

    headerTitle.click();

    // Wait for ANY right-side panel to open.
    // WhatsApp often uses <div id="app">...<div class="two">...<div class="three">...
    // The profile sidebar is typically an <aside> or a <div> that is NOT #side (the left list).

    let sidebar = null;
    const maxRetries = 20;

    for (let i = 0; i < maxRetries; i++) {
        await sleep(100);

        // Strategy: Find all 'aside' or similar containers.
        // Identify the one that is NOT the chat list (#pane-side grandparent is usually #side)

        const candidates = [
            ...document.querySelectorAll('aside'),
            ...document.querySelectorAll('div[data-animate-modal-body="true"]'), // Sometimes modals
            ...document.querySelectorAll('div[role="region"]') // Sometimes regions
        ];

        // Filter: Must be visible and distinct from the main chat list
        sidebar = candidates.find(el => {
            const rect = el.getBoundingClientRect();
            // It should be on the right side of the screen
            const isRightSide = rect.left > window.innerWidth / 2;
            const isVisible = rect.width > 0 && rect.height > 0;
            // It should not be the left sidebar
            const isNotLeftSidebar = !el.closest('#side');

            return isRightSide && isVisible && isNotLeftSidebar;
        });

        if (sidebar) break;
    }

    // If we absolutely can't find a "Right Side Panel", fall back to searching the whole body
    // BUT we must be careful about that "Bad Number".
    const scope = sidebar || document.body;
    if (!sidebar) console.warn("Robust Scraper: Sidebar not specifically identified, searching Body broadly.");

    await sleep(300); // Wait for text to render

    // 2. Scan for numbers
    const phoneRegex = /^\+?\d{2,3}[\s-]?\d{2}[\s-]?\d{4,5}[\s-]?\d{4}$/;

    // Get all text nodes or specific blocks
    // Focusing on spans and divs with text
    const elements = Array.from(scope.querySelectorAll('span, div[dir="auto"]'));

    let foundPhone = null;

    // Known bad numbers (Global/System numbers) - blacklist
    const badNumbers = [
        '555195536170', // User reported this one
        '55519553-6170'
    ];

    for (const el of elements) {
        const text = el.innerText?.trim();
        if (text && phoneRegex.test(text)) {
            // Basic validity check
            if (!text.includes(':') && text.length < 30) { // Avoid long sentences or times
                const clean = text.replace(/\D/g, '');

                // Ignore if it's the "Bad Number"
                if (badNumbers.includes(clean)) continue;

                // Heuristic: If we found a number, and it's NOT the bad one, it's likely the candidate.
                // Usually the contact info number is prominent.
                foundPhone = clean;

                // If we are in the specific sidebar, the first valid number is almost always the right one (About/Phone).
                if (sidebar) break;
            }
        }
    }

    // 3. Close the Sidebar (if we opened it)
    if (sidebar) {
        const closeBtn = document.querySelector('span[data-icon="x"]')?.closest('button') ||
            document.querySelector('div[role="button"][aria-label="Close"]');
        if (closeBtn) closeBtn.click();
    }

    return foundPhone;
};
