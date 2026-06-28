const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL;

function initHeader(): void {
    document.getElementById("btn-close")?.addEventListener("click", () => {
        window.close();
    });
}

function initDemoScreen(): void {
    document.getElementById("btn-register")?.addEventListener("click", () => {
        chrome.tabs.create({
            url: `${FRONTEND_URL}/register?source=extension`,
        });
    });
    document.getElementById("btn-login")?.addEventListener("click", () => {
        chrome.tabs.create({
            url: `${FRONTEND_URL}/login?source=extension`,
        });
    });
}

function init(): void {
    initHeader();
    initDemoScreen();
}

document.addEventListener("DOMContentLoaded", init);
