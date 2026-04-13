// ===== Data Model =====
// { portfolios: [{ id, name, stocks: [{ symbol, quantity, buyPrice, buyDate }] }] }

const LAST_ACTIVE_KEY = 'lastActiveId';

let state       = loadState();
let apiKey      = localStorage.getItem('apiKey') || '';
let activeId    = null; // current portfolio id, or 'summary'
let prices      = {};   // { SYMBOL: { price, change, changePercent } | null | 'loading' }
let fetching    = false;
let modalMode   = '';   // 'create' | 'rename'
let modalTarget = null;
let uploadTargetId = null; // portfolio id for pending Excel upload

// ===== Bootstrap =====
document.addEventListener('DOMContentLoaded', () => {
    if (apiKey) document.getElementById('apiKeyInput').value = apiKey;

    // Create a default portfolio if none exists
    if (state.portfolios.length === 0) {
        state.portfolios.push({ id: uid(), name: 'התיק שלי', stocks: [] });
        saveState();
    }

    const storedActive = loadActiveId();
    if (storedActive === 'summary' || state.portfolios.some(p => p.id === storedActive)) {
        activeId = storedActive;
    }
    if (!activeId) {
        activeId = state.portfolios.length > 0 ? state.portfolios[0].id : 'summary';
    }

    renderSidebar();
    renderMain();
    saveActiveId();

    if (apiKey) fetchAllPrices();

    // Auto-reload saved Excel files to refresh broker data (percentages etc.)
    state.portfolios.forEach(p => {
        if (p.stocks.length > 0 && getExcelMeta(p.id)) {
            uploadTargetId = p.id;
            reloadSavedExcel(p.id);
        }
    });
    uploadTargetId = null;
});

// ===== State Persistence =====
function loadState() {
    try {
        return JSON.parse(localStorage.getItem('appState')) || { portfolios: [] };
    } catch { return { portfolios: [] }; }
}

function saveState() {
    localStorage.setItem('appState', JSON.stringify(state));
}

function loadActiveId() {
    return localStorage.getItem(LAST_ACTIVE_KEY);
}

function saveActiveId() {
    if (activeId) {
        localStorage.setItem(LAST_ACTIVE_KEY, activeId);
    } else {
        localStorage.removeItem(LAST_ACTIVE_KEY);
    }
}

// ===== Settings =====
function toggleSettings() {
    document.getElementById('settingsPanel').classList.toggle('hidden');
}

function saveApiKey() {
    const val = document.getElementById('apiKeyInput').value.trim();
    if (!val) { showToast('אנא הכנס מפתח API', 'error'); return; }
    apiKey = val;
    localStorage.setItem('apiKey', apiKey);
    const s = document.getElementById('apiKeyStatus');
    s.textContent = '✓ נשמר'; s.style.color = 'var(--green)';
    showToast('מפתח API נשמר', 'success');
    fetchAllPrices();
}

// ===== Sidebar =====
function renderSidebar() {
    const list = document.getElementById('portfolioList');
    list.innerHTML = '';

    // סיכום תיקים — פריט ראשון ברשימה
    const summaryLi = document.createElement('li');
    summaryLi.className = 'portfolio-list-item';
    summaryLi.innerHTML = `
        <button class="sidebar-item ${activeId === 'summary' ? 'active' : ''}" onclick="showSummary()">
            <span class="sidebar-item-icon">📊</span>
            <span>סיכום תיקים</span>
        </button>`;
    list.appendChild(summaryLi);

    state.portfolios.forEach(p => {
        const li = document.createElement('li');
        li.className = 'portfolio-list-item';
        li.innerHTML = `
            <button class="sidebar-item ${activeId === p.id ? 'active' : ''}" onclick="switchPortfolio('${p.id}')">
                <span class="sidebar-dot"></span>
                <span>${escHtml(p.name)}</span>
            </button>
            <div class="portfolio-actions">
                <button class="btn-mini" onclick="renamePortfolio('${p.id}')" title="שנה שם">✏️</button>
                <button class="btn-mini del" onclick="deletePortfolio('${p.id}')" title="מחק תיק">🗑</button>
            </div>`;
        list.appendChild(li);
    });
}

// ===== Navigation =====
function switchPortfolio(id) {
    activeId = id;
    saveActiveId();
    renderSidebar();
    renderMain();
}

function showSummary() {
    activeId = 'summary';
    saveActiveId();
    renderSidebar();
    renderMain();
}

// ===== Create / Rename / Delete Portfolio =====
function createPortfolio() {
    modalMode = 'create';
    modalTarget = null;
    openModal('תיק חדש', '');
}

function renamePortfolio(id) {
    modalMode = 'rename';
    modalTarget = id;
    const p = state.portfolios.find(x => x.id === id);
    openModal('שנה שם תיק', p ? p.name : '');
}

function deletePortfolio(id) {
    const p = state.portfolios.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`למחוק את התיק "${p.name}"?\nפעולה זו תמחק גם את כל המניות שבו.`)) return;

    state.portfolios = state.portfolios.filter(x => x.id !== id);
    localStorage.removeItem(`savedExcel_${id}`);
    saveState();

    if (activeId === id) {
        activeId = state.portfolios.length > 0 ? state.portfolios[0].id : 'summary';
        saveActiveId();
    }

    renderSidebar();
    renderMain();
    showToast(`תיק "${p.name}" נמחק`);
}

// ===== Modal =====
function openModal(title, value) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalInput').value = value;
    document.getElementById('modalOverlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('modalInput').focus(), 50);
}

function closeModal() {
    document.getElementById('modalOverlay').classList.add('hidden');
}

function confirmModal() {
    const name = document.getElementById('modalInput').value.trim();
    if (!name) { showToast('אנא הכנס שם לתיק', 'error'); return; }

    if (modalMode === 'create') {
        const newP = { id: uid(), name, stocks: [] };
        state.portfolios.push(newP);
        saveState();
        activeId = newP.id;
        saveActiveId();
        showToast(`תיק "${name}" נוצר`, 'success');
    } else if (modalMode === 'rename') {
        const p = state.portfolios.find(x => x.id === modalTarget);
        if (p) { p.name = name; saveState(); showToast('שם עודכן', 'success'); }
    }

    closeModal();
    renderSidebar();
    renderMain();
}

// ===== Render Main =====
function renderMain() {
    const main = document.getElementById('mainContent');
    if (activeId === 'summary') {
        main.innerHTML = buildSummaryPage();
    } else {
        const p = state.portfolios.find(x => x.id === activeId);
        if (!p) { main.innerHTML = '<p style="padding:2rem;color:var(--text-muted)">בחר תיק מהרשימה</p>'; return; }
        main.innerHTML = buildPortfolioPage(p);
    }
}

// ===== Portfolio Page HTML =====
function buildPortfolioPage(p) {
    const cur = p.brokerCurrency || portCurrency(p); // brokerCurrency set at import time takes priority

    // Calc summary numbers
    let totalInvested = 0, totalCurrent = 0, hasLivePrices = false;

    p.stocks.forEach(s => {
        // Derive invested from broker data when available (valueInCurrency - pnlFromBroker)
        // This is more accurate than quantity × שער עלות למס (tax-adjusted cost basis)
        const sInvested = (!isNaN(s.pnlFromBroker) && !isNaN(s.valueInCurrency) && s.valueInCurrency > 0)
            ? s.valueInCurrency - s.pnlFromBroker
            : s.quantity * s.buyPrice;
        totalInvested += sInvested;
        const pd = prices[s.symbol];
        // When broker already converted to ILS (valueCurrency='ILS'), prefer that over live USD price
        if (pd && pd !== 'loading' && s.valueCurrency !== 'ILS') {
            totalCurrent += s.quantity * pd.price;
            hasLivePrices = true;
        } else if (!isNaN(s.valueInCurrency) && s.valueInCurrency > 0) {
            totalCurrent += s.valueInCurrency;
            hasLivePrices = true;
        }
    });

    const pnl    = totalCurrent - totalInvested;
    const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

    const pnlClass = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '';

    const _savedMeta = getExcelMeta(p.id);
    return `
    <div class="page-header">
        <span class="page-title">📁 ${escHtml(p.name)}</span>
        <div class="header-actions">
            <span id="lastUpdated" class="last-updated"></span>
            <div class="excel-actions">
                ${_savedMeta
                    ? `<span class="saved-excel-group">
                        <button type="button" class="btn-excel" onclick="reloadSavedExcel('${p.id}')" title="${escHtml(_savedMeta.filename)}">🔄 רענן מקובץ <small style="opacity:.6">${fmtDate(_savedMeta.savedAt.split('T')[0])}</small></button>
                        <button type="button" class="btn-excel-clear" onclick="clearSavedExcel('${p.id}')" title="מחק קובץ שמור">×</button>
                       </span>`
                    : ''}
                <button type="button" class="btn-excel" onclick="triggerExcelUpload('${p.id}')">📂 ייבא Excel</button>
            </div>
            <button class="btn-secondary" onclick="refreshAll()">🔄 רענן מחירים</button>
        </div>
    </div>

    <div class="summary-grid">
        <div class="summary-card">
            <span class="summary-label">סה"כ השקעה</span>
            <span class="summary-value">${fmt(totalInvested, cur)}</span>
        </div>
        <div class="summary-card">
            <span class="summary-label">שווי נוכחי</span>
            <span class="summary-value">${hasLivePrices ? fmt(totalCurrent, cur) : '—'}</span>
        </div>
        <div class="summary-card">
            <span class="summary-label">רווח / הפסד</span>
            <span class="summary-value ${pnlClass}">${hasLivePrices ? (pnl >= 0 ? '+' : '') + fmt(pnl, cur) : '—'}</span>
        </div>
        <div class="summary-card">
            <span class="summary-label">תשואה</span>
            <span class="summary-value ${pnlClass}">${hasLivePrices ? (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%' : '—'}</span>
        </div>
    </div>

    <div class="add-stock-section">
        <div class="add-stock-header">
            <h3>הוסף מניה לתיק</h3>
            <div class="excel-actions">
                <button type="button" class="btn-excel-template" onclick="downloadTemplate()">⬇️ הורד תבנית</button>
            </div>
        </div>
        <form onsubmit="addStock(event, '${p.id}')">
            <div class="form-grid">
                <div class="form-group">
                    <label>סימול</label>
                    <input type="text" id="f-symbol" placeholder="AAPL" required>
                    <small>AAPL · MSFT · TSLA · GOOGL</small>
                </div>
                <div class="form-group">
                    <label>כמות</label>
                    <input type="number" id="f-qty" placeholder="10" min="0.0001" step="any" required>
                </div>
                <div class="form-group">
                    <label>מחיר קנייה ($)</label>
                    <input type="number" id="f-price" placeholder="150.00" min="0.01" step="any" required>
                </div>
                <div class="form-group">
                    <label>תאריך קנייה</label>
                    <input type="date" id="f-date" value="${todayStr()}">
                </div>
            </div>
            <button type="submit" class="btn-primary">+ הוסף</button>
        </form>
    </div>

    <div class="table-wrapper">
        ${buildStocksTable(p)}
    </div>`;
}

// ===== Stocks Table HTML =====
function buildStocksTable(p) {
    if (p.stocks.length === 0) {
        return `<table><thead><tr>
            <th>סימול</th><th>שם ניע</th><th>שער אחרון</th>
            <th>שינוי מרכישה%</th><th>שווי</th><th>רווח/הפסד</th><th>מטבע</th><th></th>
        </tr></thead><tbody>
        <tr><td colspan="8" class="empty-message">
            <div class="empty-icon">📭</div><div>אין מניות בתיק — הוסף מניה למעלה</div>
        </td></tr></tbody></table>`;
    }

    let rows = '';
    p.stocks.forEach(s => {
        const pd       = prices[s.symbol];
        const isLoad   = pd === 'loading';
        const hasData  = pd && pd !== 'loading';
        // Derive invested from broker data when available (more accurate than quantity × tax cost basis)
        const invested = (!isNaN(s.pnlFromBroker) && !isNaN(s.valueInCurrency) && s.valueInCurrency > 0)
            ? s.valueInCurrency - s.pnlFromBroker
            : s.quantity * s.buyPrice;
        const currency = s.valueCurrency || p.brokerCurrency || s.currency || 'USD';
        const name     = s.name     || s.symbol;

        // --- Main row values ---
        let lastPriceCell = isLoad ? '<span class="loading-cell">טוען…</span>' : '—';
        let fromBuyPct    = '—', fromBuyClass = 'neutral';
        let fromCostPct   = '—', fromCostClass = 'neutral';
        let value         = '—';
        let dayPct        = '—', dayClass = 'neutral';
        let pnl = 0;

        // When broker already converted to ILS, don't mix with live USD prices
        const useLivePrice = hasData && s.valueCurrency !== 'ILS';

        if (useLivePrice) {
            // Live API data (native currency, no ILS conversion by broker)
            const cp  = pd.price;
            const cv  = s.quantity * cp;
            pnl       = cv - invested;
            const pp  = s.buyPrice > 0 ? ((cp - s.buyPrice) / s.buyPrice) * 100 : 0;

            fromBuyClass  = pp > 0 ? 'positive' : pp < 0 ? 'negative' : 'neutral';
            dayClass      = pd.change >= 0 ? 'positive' : 'negative';

            lastPriceCell = fmtCurrency(cp, currency);
            dayPct        = (pd.changePercent >= 0 ? '+' : '') + pd.changePercent.toFixed(2) + '%';
            fromBuyPct    = (pp >= 0 ? '+' : '') + pp.toFixed(2) + '%';
            value         = fmtCurrency(cv, currency);
        } else {
            // Use broker Excel data (also when valueCurrency=ILS — broker's ILS value is authoritative)
            if (hasData) {
                // Still show day change from live data
                dayClass = pd.change >= 0 ? 'positive' : 'negative';
                dayPct   = (pd.changePercent >= 0 ? '+' : '') + pd.changePercent.toFixed(2) + '%';
            }
            if (!isNaN(s.lastPrice) && s.lastPrice > 0) {
                lastPriceCell = fmtCurrency(s.lastPrice, s.valueCurrency || currency) + ' <small style="opacity:.5">*</small>';
            }
            if (!isNaN(s.changeFromBuyPct)) {
                fromBuyPct   = (s.changeFromBuyPct >= 0 ? '+' : '') + Number(s.changeFromBuyPct).toFixed(2) + '%';
                fromBuyClass = s.changeFromBuyPct > 0 ? 'positive' : s.changeFromBuyPct < 0 ? 'negative' : 'neutral';
            }
            if (!isNaN(s.valueInCurrency) && s.valueInCurrency > 0) {
                value = fmtCurrency(s.valueInCurrency, s.valueCurrency || currency);
            }
            // Use broker's own P&L calculation — most accurate
            if (!isNaN(s.pnlFromBroker)) {
                pnl = s.pnlFromBroker;
            } else if (!isNaN(s.valueInCurrency) && s.valueInCurrency > 0) {
                pnl = s.valueInCurrency - invested;
            }
        }

        // שינוי משער עלות% — always from broker data
        if (!isNaN(s.changeFromCostPct)) {
            fromCostPct   = (s.changeFromCostPct >= 0 ? '+' : '') + Number(s.changeFromCostPct).toFixed(2) + '%';
            fromCostClass = s.changeFromCostPct > 0 ? 'positive' : s.changeFromCostPct < 0 ? 'negative' : 'neutral';
        }

        // --- P&L (prefer broker's value, fallback to API-based calculation) ---
        const hasPnl   = hasData || !isNaN(s.pnlFromBroker) || (!isNaN(s.valueInCurrency) && s.valueInCurrency > 0);
        // If broker provides direct P&L — use it (accurate incl. FX, fees, tax basis)
        const displayPnl = (!isNaN(s.pnlFromBroker) && !hasData) ? s.pnlFromBroker : pnl;
        const pnlStr   = hasPnl ? (displayPnl >= 0 ? '+' : '') + fmtCurrency(displayPnl, currency) : '—';
        const pnlClass = displayPnl > 0 ? 'positive' : displayPnl < 0 ? 'negative' : '';
        const safeId   = `${p.id}-${s.symbol}`.replace(/[^a-zA-Z0-9-_]/g, '_');

        rows += `
        <tr class="stock-row">
            <td class="symbol-cell">${escHtml(s.symbol)}</td>
            <td class="name-cell" title="${escHtml(name)}">${escHtml(name)}</td>
            <td class="price-cell">${lastPriceCell}</td>
            <td class="${fromBuyClass} price-cell"><span class="badge ${fromBuyClass}">${fromBuyPct}</span></td>
            <td class="price-cell">${value}</td>
            <td class="${pnlClass} price-cell">${pnlStr}</td>
            <td class="currency-cell">${escHtml(currency)}</td>
            <td><button class="btn-expand" onclick="toggleExpand(this,'${safeId}')" title="פרטים נוספים">▼</button></td>
        </tr>
        <tr class="expand-row hidden" id="exp-${safeId}">
            <td colspan="8">
                <div class="expand-details">
                    <span><label>כמות</label>${s.quantity.toLocaleString()}</span>
                    <span><label>מחיר קנייה</label>${fmtCurrency(s.buyPrice, currency)}</span>
                    <span><label>השקעה</label>${fmtCurrency(invested, currency)}</span>
                    <span><label>שינוי יומי%</label><span class="${dayClass}">${dayPct}</span></span>
                    <span><label>שינוי משער עלות%</label><span class="${fromCostClass}">${fromCostPct}</span></span>
                    <span><label>תאריך</label>${fmtDate(s.buyDate)}</span>
                    <button class="btn-delete" onclick="removeStock('${p.id}','${s.symbol}')">🗑 מחק מניה</button>
                </div>
            </td>
        </tr>`;
    });

    return `<table><thead><tr>
        <th>סימול</th><th>שם ניע</th><th>שער אחרון</th>
        <th>שינוי מרכישה%</th><th>שווי</th><th>רווח/הפסד</th><th>מטבע</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function toggleExpand(btn, id) {
    const row = document.getElementById('exp-' + id);
    if (!row) return;
    const opening = row.classList.contains('hidden');
    row.classList.toggle('hidden');
    btn.textContent = opening ? '▲' : '▼';
    btn.title       = opening ? 'הסתר פרטים' : 'פרטים נוספים';
}

function fmtCurrency(n, currency) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    const sym = isILS(currency) ? '₪' : '$';
    return sym + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ===== Summary Page =====
function buildSummaryPage() {
    if (state.portfolios.length === 0) {
        return `<div style="padding:2rem;color:var(--text-muted);text-align:center">
            <div style="font-size:2rem;margin-bottom:0.5rem">📊</div>
            <div>אין תיקים — צור תיק מהתפריט הצדדי</div>
        </div>`;
    }

    let grandInvested = 0, grandCurrent = 0;
    let blocks = '';

    state.portfolios.forEach(p => {
        const pCur = p.brokerCurrency || portCurrency(p);
        let inv = 0, cur = 0, hasLive = false;
        p.stocks.forEach(s => {
            inv += (!isNaN(s.pnlFromBroker) && !isNaN(s.valueInCurrency) && s.valueInCurrency > 0)
                ? s.valueInCurrency - s.pnlFromBroker
                : s.quantity * s.buyPrice;
            const pd = prices[s.symbol];
            if (pd && pd !== 'loading' && s.valueCurrency !== 'ILS') {
                cur += s.quantity * pd.price; hasLive = true;
            } else if (!isNaN(s.valueInCurrency) && s.valueInCurrency > 0) {
                cur += s.valueInCurrency; hasLive = true;
            }
        });
        grandInvested += inv;
        grandCurrent  += cur;

        const pnl    = cur - inv;
        const pnlPct = inv > 0 ? (pnl / inv) * 100 : 0;
        const cls    = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '';

        blocks += `
        <div class="summary-portfolio-block">
            <div class="summary-portfolio-header">
                <span class="summary-portfolio-name">📁 ${escHtml(p.name)}</span>
            </div>
            <div class="summary-portfolio-cards">
                <div class="summary-portfolio-card">
                    <span class="lbl">סה"כ השקעה</span>
                    <span class="val">${fmt(inv, pCur)}</span>
                </div>
                <div class="summary-portfolio-card">
                    <span class="lbl">שווי נוכחי</span>
                    <span class="val">${hasLive ? fmt(cur, pCur) : '—'}</span>
                </div>
                <div class="summary-portfolio-card">
                    <span class="lbl">רווח / הפסד</span>
                    <span class="val ${cls}">${hasLive ? (pnl >= 0 ? '+' : '') + fmt(pnl, pCur) : '—'}</span>
                </div>
                <div class="summary-portfolio-card">
                    <span class="lbl">תשואה</span>
                    <span class="val ${cls}">${hasLive ? (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%' : '—'}</span>
                </div>
            </div>
        </div>`;
    });

    const gPnl    = grandCurrent - grandInvested;
    const gPnlPct = grandInvested > 0 ? (gPnl / grandInvested) * 100 : 0;
    const gCls    = gPnl > 0 ? 'positive' : gPnl < 0 ? 'negative' : '';
    const hasAny  = grandCurrent > 0;
    // Grand total currency: if all portfolios same currency, use it; else show ₪ (most common for Israeli users)
    const allCurs = state.portfolios.map(p => portCurrency(p));
    const grandCur = allCurs.every(c => c === allCurs[0]) ? allCurs[0] : 'ILS';

    return `
    <div class="page-header">
        <span class="page-title">📊 סיכום תיקים</span>
        <div class="header-actions">
            <span id="lastUpdated" class="last-updated"></span>
            <button class="btn-secondary" onclick="refreshAll()">🔄 רענן מחירים</button>
        </div>
    </div>

    <div class="grand-total-row">
        <span class="label">סה"כ כל התיקים</span>
        <div class="grand-total-stats">
            <div class="grand-total-stat">
                <span class="lbl">סה"כ השקעה</span>
                <span class="val">${fmt(grandInvested, grandCur)}</span>
            </div>
            <div class="grand-total-stat">
                <span class="lbl">שווי נוכחי</span>
                <span class="val">${hasAny ? fmt(grandCurrent, grandCur) : '—'}</span>
            </div>
            <div class="grand-total-stat">
                <span class="lbl">רווח / הפסד</span>
                <span class="val ${gCls}">${hasAny ? (gPnl >= 0 ? '+' : '') + fmt(gPnl, grandCur) : '—'}</span>
            </div>
            <div class="grand-total-stat">
                <span class="lbl">תשואה כוללת</span>
                <span class="val ${gCls}">${hasAny ? (gPnlPct >= 0 ? '+' : '') + gPnlPct.toFixed(2) + '%' : '—'}</span>
            </div>
        </div>
    </div>

    ${blocks}`;
}

// ===== Add / Remove Stock =====
function addStock(event, portfolioId) {
    event.preventDefault();
    const p = state.portfolios.find(x => x.id === portfolioId);
    if (!p) return;

    const symbol   = document.getElementById('f-symbol').value.trim().toUpperCase();
    const quantity = parseFloat(document.getElementById('f-qty').value);
    const buyPrice = parseFloat(document.getElementById('f-price').value);
    const buyDate  = document.getElementById('f-date').value;

    if (!symbol || isNaN(quantity) || isNaN(buyPrice)) {
        showToast('אנא מלא את כל השדות', 'error'); return;
    }

    if (p.stocks.find(s => s.symbol === symbol)) {
        showToast(`${symbol} כבר קיים בתיק זה`, 'error'); return;
    }

    p.stocks.push({ symbol, quantity, buyPrice, buyDate });
    saveState();
    renderMain();
    showToast(`${symbol} נוסף`, 'success');

    if (apiKey && !prices[symbol]) {
        prices[symbol] = 'loading';
        fetchPrice(symbol).then(() => renderMain());
    }
}

function removeStock(portfolioId, symbol) {
    const p = state.portfolios.find(x => x.id === portfolioId);
    if (!p || !confirm(`למחוק את ${symbol} מהתיק?`)) return;
    p.stocks = p.stocks.filter(s => s.symbol !== symbol);
    saveState();
    renderMain();
    showToast(`${symbol} הוסר`);
}

// ===== Fetch Prices =====
async function fetchPrice(symbol) {
    if (!apiKey) return;

    const tryFetch = async (sym) => {
        const res  = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`);
        const data = await res.json();
        if (data && data.c > 0) {
            return { price: data.c, change: data.c - data.pc, changePercent: ((data.c - data.pc) / data.pc) * 100 };
        }
        return null;
    };

    try {
        let result = await tryFetch(symbol);

        // Fallback: try with .TA suffix (Israeli TASE stocks: ESLT → ESLT.TA)
        if (!result && !symbol.includes('.')) {
            console.log(`[Finnhub] ${symbol} returned 0 — trying ${symbol}.TA`);
            result = await tryFetch(symbol + '.TA');
        }

        prices[symbol] = result;
        console.log(`[Finnhub] ${symbol}:`, result ? `${result.price} (${result.changePercent.toFixed(2)}%)` : 'לא נמצא');
    } catch (e) {
        prices[symbol] = null;
        console.error('[Finnhub] Error for', symbol, e);
    }
}

async function refreshAll() {
    if (fetching) return;
    if (!apiKey) { showToast('הגדר מפתח API תחילה', 'error'); toggleSettings(); return; }

    // Collect all unique symbols across all portfolios
    const symbols = [...new Set(state.portfolios.flatMap(p => p.stocks.map(s => s.symbol)))];
    if (symbols.length === 0) return;

    fetching = true;

    symbols.forEach(sym => { prices[sym] = 'loading'; });
    renderMain();

    await Promise.all(symbols.map(sym => fetchPrice(sym)));

    fetching = false;
    const now = new Date();
    const el  = document.getElementById('lastUpdated');
    if (el) el.textContent = `עודכן: ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    renderMain();
    showToast('מחירים עודכנו', 'success');
}

async function fetchAllPrices() {
    const symbols = [...new Set(state.portfolios.flatMap(p => p.stocks.map(s => s.symbol)))];
    if (symbols.length === 0 || !apiKey) return;
    await Promise.all(symbols.map(sym => fetchPrice(sym)));
    renderMain();
}

// ===== Helpers =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function isILS(currency) {
    const c = String(currency || '').trim();
    return c === 'ILS' || c === 'NIS' || c === 'nis'
        || c === 'ש"ח' || c === 'שח' || c.includes('שקל');
}

// Determine dominant currency of a portfolio (most common among stocks)
function portCurrency(p) {
    const counts = {};
    (p.stocks || []).forEach(s => {
        const c = s.valueCurrency || s.currency || 'USD';
        counts[c] = (counts[c] || 0) + 1;
    });
    const entries = Object.entries(counts);
    if (!entries.length) return 'USD';
    return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function fmt(n, currency) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return fmtCurrency(n, currency || 'USD');
}

function fmtDate(d) {
    if (!d) return '—';
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y}`;
}

function todayStr() { return new Date().toISOString().split('T')[0]; }
function pad(n)     { return n.toString().padStart(2, '0'); }
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ===== Toast =====
let toastTimer;
function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = 'toast' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    const duration = type === 'error' ? 10000 : 3000;
    toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, duration);
}

// ===== Excel Import =====
function triggerExcelUpload(portfolioId) {
    uploadTargetId = portfolioId;
    const input = document.getElementById('excelFileInput');
    input.value = ''; // reset so same file can be re-uploaded
    input.click();
}

// ===== Excel File Storage =====
function saveExcelToStorage(portfolioId, filename, arrayBuffer) {
    try {
        const bytes = new Uint8Array(arrayBuffer);
        let bin = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        localStorage.setItem(`savedExcel_${portfolioId}`, JSON.stringify({
            filename, base64: btoa(bin), savedAt: new Date().toISOString()
        }));
        console.log(`[Excel] נשמר: ${filename}`);
    } catch(e) {
        console.warn('לא ניתן לשמור קובץ Excel:', e.message);
        showToast('⚠️ הקובץ לא נשמר (אחסון מלא) — יש לייבא בכל כניסה', 'error');
    }
}

function clearSavedExcel(portfolioId) {
    if (!confirm('למחוק את קובץ ה-Excel השמור?\nהנתונים בתיק לא יימחקו, רק הקובץ השמור.')) return;
    localStorage.removeItem(`savedExcel_${portfolioId}`);
    showToast('קובץ Excel השמור נמחק');
    renderMain();
}

function getExcelMeta(portfolioId) {
    try {
        const raw = localStorage.getItem(`savedExcel_${portfolioId}`);
        if (!raw) return null;
        const { filename, savedAt } = JSON.parse(raw);
        return { filename, savedAt };
    } catch(e) { return null; }
}

function reloadSavedExcel(portfolioId) {
    try {
        const raw = localStorage.getItem(`savedExcel_${portfolioId}`);
        if (!raw) { showToast('אין קובץ Excel שמור', 'error'); return; }
        const { filename, base64 } = JSON.parse(raw);
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        uploadTargetId = portfolioId;
        showToast(`טוען: ${filename}…`);
        processExcelBuffer(bytes.buffer);
    } catch(e) {
        console.error(e);
        showToast('שגיאה בטעינת קובץ שמור', 'error');
    }
}

// ===== Excel Import =====
function handleExcelUpload(event) {
    const file = event.target.files[0];
    if (!file || !uploadTargetId) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        saveExcelToStorage(uploadTargetId, file.name, e.target.result);
        processExcelBuffer(e.target.result);
    };
    reader.readAsArrayBuffer(file);
}

function processExcelBuffer(buffer) {
    const p = state.portfolios.find(x => x.id === uploadTargetId);
    if (!p) return;
    try {
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
            const sheet    = workbook.Sheets[workbook.SheetNames[0]];

            // Read all rows as arrays (no assumption about header row location)
            const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

            // Normalize header: strip ALL invisible Unicode chars (RTL marks, zero-width, BOM, etc.)
            // Defined FIRST so it can be used during detection as well
            const normH = s => String(s)
                .replace(/[\u0000-\u001f\u007f-\u009f\u00a0\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
                .replace(/[\u05F4\u201C\u201D\u00AB\u00BB]/g, '"')  // Gershayim ״ + curly/guillemet quotes → "
                .replace(/[\u05F3\u2018\u2019\u0060\u00B4]/g, "'")  // Geresh ׳ + curly apostrophes → '
                .replace(/\s+/g, ' ')
                .trim();

            // Known header identifiers — any of these in a row signals the header row
            const COL_SYMBOL            = ['סימבול','סימול','symbol','ticker','מניה','stock','מס.ניע','מס. ניע','מספר ניע','מספר נייר'];
            const COL_NAME              = ['שם ניע','שם נייר ערך','שם נייר','name','stock name'];
            const COL_QTY               = ['כמות בתיק','כמות','quantity','qty','shares','מניות','יחידות'];
            const COL_PRICE             = ['שער עלות','שער עלות למס','שער עלות מתאם','מחיר קנייה','מחיר','buy price','price','purchase price'];
            const COL_DATE              = ['תאריך פעולה אחרונה','תאריך קנייה','תאריך','date','buy date','purchase date'];
            const COL_CURRENCY          = ['מטבע','currency','curr'];
            const COL_LAST_PRICE        = ['שער אחרון'];
            const COL_CHANGE_FROM_BUY   = ['%שינוי מרכישה','שינוי מרכישה%','% שינוי מרכישה'];
            const COL_VALUE             = ['שווי אחזקה','שווי במטבע','שווי אחזקה במטבע הנייר'];
            const COL_CHANGE_FROM_COST  = ['שינוי מעלות %','שינוי מעלות','%שינוי משער עלות למס','%שינוי משער עלות','שינוי משער עלות'];
            const COL_PNL_ABS           = ['שינוי מרכישה','שינוי מעלות בש"ח'];  // absolute P&L from broker (exact match only)
            const ALL_KNOWN    = [...COL_SYMBOL, ...COL_NAME, ...COL_QTY, ...COL_PRICE, ...COL_DATE, ...COL_CURRENCY,
                                   ...COL_LAST_PRICE, ...COL_CHANGE_FROM_BUY, ...COL_VALUE, ...COL_CHANGE_FROM_COST,
                                   ...COL_PNL_ABS];
            const ALL_KNOWN_NORM = ALL_KNOWN.map(k => normH(k));

            // Scan ALL rows — pick the one with the MOST exact header matches.
            // Using exact match only (not partial) to avoid false positives like
            // "מספר ניירות" matching "מספר נייר".
            let headerRowIdx = -1;
            let bestMatchCount = 1; // row must beat this to qualify (so minimum = 2)
            for (let i = 0; i < allRows.length; i++) {
                const cells = allRows[i].map(c => normH(String(c)));
                const matches = cells.filter(c => c && ALL_KNOWN_NORM.includes(c));
                if (matches.length > bestMatchCount) { bestMatchCount = matches.length; headerRowIdx = i; }
            }

            if (headerRowIdx === -1) {
                // Show what was actually found in the first rows to help diagnose
                const sample = allRows.slice(0, 10)
                    .map(r => r.map(c => normH(String(c))).filter(c => c).join(' | '))
                    .filter(r => r)
                    .slice(0, 4)
                    .join('\n');
                showToast(`לא נמצאה שורת כותרות.\nשורות שנמצאו בקובץ:\n${sample}`, 'error');
                console.warn('Excel rows sample:', allRows.slice(0, 10));
                return;
            }

            // Build header list and data rows (using normalized keys)
            const headers  = allRows[headerRowIdx].map(c => normH(c));
            const dataRows = allRows.slice(headerRowIdx + 1)
                .filter(row => row.some(c => c !== '' && c !== null && c !== undefined));

            // Convert each data row to an object keyed by NORMALIZED header
            const rows = dataRows.map(row => {
                const obj = {};
                headers.forEach((h, i) => { if (h) obj[h] = row[i] !== undefined ? row[i] : ''; });
                return obj;
            });

            if (rows.length === 0) { showToast('לא נמצאו שורות נתונים', 'error'); return; }

            const findCol = (candidates) => {
                const normCands = candidates.map(c => normH(c));
                // Levels 1-2: iterate CANDIDATES in priority order so first candidate wins
                for (const nc of normCands) {
                    // 1. Exact match
                    if (headers.includes(nc)) return nc;
                }
                for (const nc of normCands) {
                    // 2. Case-insensitive exact match
                    const h = headers.find(hh => hh.toLowerCase() === nc.toLowerCase());
                    if (h) return h;
                }
                // 3. Partial: header contains candidate (min 3 chars) — header order OK here
                const partial = headers.find(h => normCands.some(c => c.length >= 3 && h.includes(c)));
                if (partial) return partial;
                // 4. % position agnostic
                return headers.find(h => normCands.some(c => {
                    const hS = h.replace(/%/g, '').trim();
                    const cS = c.replace(/%/g, '').trim();
                    return cS.length >= 4 && hS === cS;
                }));
            };

            const colSymbol          = findCol(COL_SYMBOL);
            const colName            = findCol(COL_NAME);
            const colQty             = findCol(COL_QTY);
            const colPrice           = findCol(COL_PRICE);
            const colDate            = findCol(COL_DATE);
            const colCurrency        = findCol(COL_CURRENCY);
            const colLastPrice       = findCol(COL_LAST_PRICE);
            const colChangeFromBuy   = findCol(COL_CHANGE_FROM_BUY);
            const colValue           = findCol(COL_VALUE);
            // שווי אחזקה (without במטבע הנייר) is the ILS-converted total value from the broker
            const valueColIsILS      = colValue === normH('שווי אחזקה');
            // Persist broker currency on the portfolio so display is correct even without re-import
            if (valueColIsILS) p.brokerCurrency = 'ILS';
            const colChangeFromCost  = findCol(COL_CHANGE_FROM_COST);
            // Exact-only match for שינוי מרכישה (absolute P&L) to avoid matching %שינוי מרכישה
            const colPnlAbs = headers.find(h => COL_PNL_ABS.map(c => normH(c)).includes(h));

            // Debug: print all detected columns
            console.table({
                'כותרות שנמצאו':     headers.join(' | '),
                'סימול':             colSymbol          || '❌',
                'שם':                colName            || '❌',
                'כמות':              colQty             || '❌',
                'מחיר':              colPrice           || '❌',
                'תאריך':             colDate            || '❌',
                'מטבע':              colCurrency        || '❌',
                'שער אחרון':         colLastPrice       || '❌',
                'שינוי מרכישה%':     colChangeFromBuy   || '❌',
                'שווי':              colValue           || '❌',
                'שינוי משער עלות%':  colChangeFromCost  || '❌',
            });
            console.log('דוגמת שורה ראשונה:', rows[0]);

            if (!colSymbol) {
                showToast('לא נמצאה עמודת סימול / מזהה נייר ערך', 'error');
                return;
            }
            // אם אין כמות — ננסה לגזור מ־שווי ÷ שער אחרון
            const qtyDerived = !colQty && colValue && colLastPrice;
            // אם אין מחיר קנייה — נשתמש בשער אחרון כ־fallback
            const priceFallback = !colPrice && colLastPrice;

            let added = 0, skipped = 0, errors = 0;
            const newSymbols = [];
            const errorDetails = [];

            // Summary/total row keywords to skip (checked against symbol AND name)
            const SKIP_KEYWORDS = ['סה"כ', 'סהכ', 'total', 'סיכום', 'שורת סיכום',
                                   'סה"כ מניות', 'סה"כ אגח', 'סה"כ אג"ח', 'סה"כ תעודות סל',
                                   'סה"כ קרנות', 'סה"כ ניירות ערך', 'סה"כ השקעות'];

            rows.forEach((row, i) => {
                const symbol   = String(row[colSymbol] || '').trim().toUpperCase();
                const rowName  = colName ? String(row[colName] || '').trim() : '';
                const rawDate  = colDate ? row[colDate] : '';
                const buyDate  = parseExcelDate(rawDate);

                // Skip empty rows or summary rows (check both symbol and name columns)
                if (!symbol) return;
                if (SKIP_KEYWORDS.some(k => symbol.includes(k.toUpperCase()))) return;
                if (SKIP_KEYWORDS.some(k => rowName.includes(k))) return;

                const lastPriceRaw = colLastPrice ? parseNum(row[colLastPrice]) : NaN;
                const valueRaw     = colValue     ? parseNum(row[colValue])     : NaN;

                // Quantity: use column if exists, otherwise derive from שווי ÷ שער אחרון
                let quantity = colQty ? parseNum(row[colQty])
                             : qtyDerived && !isNaN(valueRaw) && !isNaN(lastPriceRaw) && lastPriceRaw > 0
                               ? Math.round(valueRaw / lastPriceRaw)
                               : NaN;

                // Buy price: use column if exists, otherwise fall back to שער אחרון
                let buyPrice = colPrice ? parseNum(row[colPrice])
                             : priceFallback && !isNaN(lastPriceRaw) ? lastPriceRaw
                             : NaN;

                // שורת כותרת קטגוריה (פועלים וכד') — כמות וערך ריקים, דלג בשקט
                if ((isNaN(quantity) || quantity <= 0) && (isNaN(valueRaw) || valueRaw <= 0)) return;

                if (isNaN(quantity) || quantity <= 0) {
                    errorDetails.push(`שורה ${i+1} (${String(row[colSymbol]||'').trim()}): כמות לא תקינה`);
                    errors++; return;
                }
                if (isNaN(buyPrice) || buyPrice < 0) {
                    errorDetails.push(`שורה ${i+1} (${String(row[colSymbol]||'').trim()}): מחיר לא תקין`);
                    errors++; return;
                }

                const name              = colName           ? String(row[colName]           || '').trim() : '';
                const currency          = colCurrency       ? String(row[colCurrency]       || '').trim() : '';
                const lastPrice         = !isNaN(lastPriceRaw) ? lastPriceRaw : NaN;
                const changeFromBuyPct  = colChangeFromBuy  ? parseNum(row[colChangeFromBuy])  : NaN;
                const valueInCurrency   = !isNaN(valueRaw)  ? valueRaw  : NaN;
                const valueCurrency     = valueColIsILS ? 'ILS' : currency;
                const changeFromCostPct = colChangeFromCost ? parseNum(row[colChangeFromCost]) : NaN;
                const pnlFromBroker     = colPnlAbs         ? parseNum(row[colPnlAbs])         : NaN;

                const existing = p.stocks.find(s => s.symbol === symbol);
                if (existing) {
                    // Update existing stock with fresh broker data (don't duplicate)
                    Object.assign(existing, { quantity, buyPrice, buyDate, name, currency, valueCurrency,
                        lastPrice, changeFromBuyPct, valueInCurrency, changeFromCostPct, pnlFromBroker });
                    skipped++;
                } else {
                    p.stocks.push({ symbol, quantity, buyPrice, buyDate, name, currency, valueCurrency,
                        lastPrice, changeFromBuyPct, valueInCurrency, changeFromCostPct, pnlFromBroker });
                    newSymbols.push(symbol);
                    added++;
                }
            });

            saveState();
            renderSidebar();
            renderMain();

            // Fetch prices for all imported symbols (new + updated)
            const allImported = p.stocks.map(s => s.symbol);
            if (apiKey && allImported.length > 0) {
                allImported.forEach(sym => { prices[sym] = 'loading'; });
                Promise.all(allImported.map(sym => fetchPrice(sym))).then(() => renderMain());
            }

            let msg = `יובאו ${added} ניירות`;
            if (skipped > 0) msg += ` | ${skipped} עודכנו`;
            if (errors  > 0) {
                const sample = errorDetails.slice(0, 3).join('\n');
                msg += `\n${errors} שורות דולגו:\n${sample}${errorDetails.length > 3 ? '\n...' : ''}`;
            }
            showToast(msg, added > 0 ? 'success' : (errors > 0 ? 'error' : ''));
            if (errorDetails.length > 0) console.warn('Excel import errors:', errorDetails);

        } catch (err) {
            console.error(err);
            showToast('שגיאה בקריאת הקובץ', 'error');
        }
}

function parseNum(val) {
    if (val === null || val === undefined || val === '') return NaN;
    if (typeof val === 'number') return val;
    // Remove thousands commas, spaces, currency symbols, RTL marks
    let s = String(val)
        .replace(/[\u200f\u200e\u202a-\u202e]/g, '') // RTL/LTR marks
        .replace(/[₪$€£]/g, '')                       // currency symbols
        .replace(/\s/g, '')                            // spaces
        .trim();
    // Handle negative in parentheses: (1,234.56) → -1234.56
    if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1);
    // Remove thousands separator commas (but keep decimal dot)
    // e.g. "1,234.56" → "1234.56"   or   "1,234" → "1234"
    s = s.replace(/,(?=\d{3}(\D|$))/g, '');
    // Also handle if comma is decimal separator (Israeli locale): "1.234,56" → "1234.56"
    if (/^\d+\.\d{3},\d+$/.test(s)) {
        s = s.replace(/\./g, '').replace(',', '.');
    }
    return parseFloat(s);
}

function parseExcelDate(val) {
    if (!val) return todayStr();
    // If it's already a JS Date (from cellDates:true)
    if (val instanceof Date) {
        return val.toISOString().split('T')[0];
    }
    // If it's a string like DD/MM/YYYY or YYYY-MM-DD
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
        const [d, m, y] = str.split('/');
        return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    return todayStr();
}

// ===== Download Template =====
function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
        ['סימול', 'כמות', 'מחיר קנייה', 'תאריך קנייה'],
        ['AAPL',  10,     150.00,        '01/01/2024'],
        ['MSFT',  5,      300.00,        '15/03/2024'],
        ['TSLA',  8,      200.00,        '10/06/2024'],
    ]);

    // Set column widths
    ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'תיק השקעות');
    XLSX.writeFile(wb, 'תבנית_תיק_השקעות.xlsx');
    showToast('התבנית הורדה', 'success');
}

// ===== Modal keyboard =====
document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !document.getElementById('modalOverlay').classList.contains('hidden')) {
        confirmModal();
    }
    if (e.key === 'Escape') closeModal();
});
