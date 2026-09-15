import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildItemCostResolver, collectPackageSources, collectExchangeSources, formatDays } from './lib/pricing-core';
import { buildPurchasePlan } from './lib/purchase-plan';
import { createItemImage } from './lib/images';

renderNav('analyze');

const itemSelect = document.getElementById('item-select');
const shopSelect = document.getElementById('shop-select');
const quantityInput = document.getElementById('quantity-input');
const ignoreLimitSelect = document.getElementById('ignore-limit-select');
const resetBtn = document.getElementById('reset-btn');
const form = document.getElementById('analyze-form');

const sourcesCard = document.getElementById('sources-card');
const sourcesTable = document.getElementById('sources-table');
const sourcesEmpty = document.getElementById('sources-empty');
const planCard = document.getElementById('plan-card');
const planTable = document.getElementById('plan-table');
const planSummary = document.getElementById('plan-summary');

let data = null;

const TYPE_LABELS = {
    package: 'Package',
    exchange: 'Exchange offer',
    exchange_offer: 'Exchange offer',
    bonus_tier: 'Bonus tier',
};

function populateItemSelect(items) {
    const grouped = {};
    for (const [itemId, item] of Object.entries(items)) {
        const category = item.category || 'Other';
        if (!grouped[category]) {
            grouped[category] = [];
        }
        grouped[category].push({ id: itemId, name: item.name });
    }

    const sortedCategories = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
    for (const category of sortedCategories) {
        grouped[category].sort((a, b) => a.name.localeCompare(b.name));
    }

    itemSelect.innerHTML = sortedCategories
        .map((category) => {
            const options = grouped[category]
                .map((item) => `<option value="${item.id}">${item.name}</option>`)
                .join('');
            return `<optgroup label="${category}">${options}</optgroup>`;
        })
        .join('');
}

function populateShopSelect(exchangeShops) {
    if (!shopSelect) {
        return;
    }
    const sortedShops = Object.entries(exchangeShops).sort((a, b) => a[1].name.localeCompare(b[1].name));
    shopSelect.innerHTML = [
        '<option value="">None</option>',
        '<option value="any">Any</option>',
        ...sortedShops.map(([shopId, shop]) => `<option value="${shopId}">${shop.name}</option>`),
    ].join('');
}

function getResolvedRequiresName(requiresId, packages, items) {
    if (!requiresId) {
        return '-';
    }
    return packages[requiresId]?.name || items[requiresId]?.name || requiresId;
}

function renderSourcesTable(sources) {
    const ordered = [...sources].sort((a, b) => a.pricePerUnit - b.pricePerUnit);

    const rows = ordered
        .map((source) => {
            const priceCell = source.type === 'exchange' ? source.priceDisplay : `${source.price} Banknotes`;
            const limitCell = Number.isFinite(source.purchaseCapacity)
                ? Number((source.purchaseCapacity * source.yieldPerPurchase).toFixed(2))
                : 'Unlimited';
            const pillClass = source.type === 'exchange' ? 'pill--exchange_offer' : `pill--${source.type}`;
            const typeLabel = TYPE_LABELS[source.type] || source.type;
            const requiresDisplay = getResolvedRequiresName(source.requires, data?.packages || {}, data?.items || {});

            return `
                <tr>
                    <td><span class="pill ${pillClass}">${typeLabel}</span></td>
                    <td>${source.name}</td>
                    <td>${source.category || '-'}</td>
                    <td>${priceCell}</td>
                    <td>${Number(source.yieldPerPurchase.toFixed(4))}</td>
                    <td>${Number.isFinite(source.pricePerUnit) ? Number(source.pricePerUnit.toFixed(2)) : 'N/A'}</td>
                    <td>${limitCell}</td>
                    <td>${formatDays(source.availableDays)}</td>
                    <td>${requiresDisplay}</td>
                </tr>
            `;
        })
        .join('');

    sourcesTable.innerHTML = `
        <thead>
            <tr>
                <th>Type</th>
                <th>Source</th>
                <th>Category</th>
                <th>Price / Purchase</th>
                <th>Yield / Purchase</th>
                <th>Banknotes / Unit</th>
                <th>Limit (units)</th>
                <th>Days</th>
                <th>Requires</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    `;
}

function renderPlanTable(result, targetItemId) {
    if (result.plan.length === 0) {
        planTable.innerHTML = '';
        planSummary.textContent = 'No purchasable sources found for this item.';
        return;
    }

    const rows = result.plan
        .map(({ source, purchases, unitsGained, cost }) => {
            return `
                <tr>
                    <td class="item-cell"></td>
                    <td>${source.category || '-'}</td>
                    <td>${formatDays(source.availableDays)}</td>
                    <td>${purchases}</td>
                    <td>${unitsGained}</td>
                    <td>${cost}</td>
                    <td>${Number.isFinite(source.pricePerUnit) ? Number(source.pricePerUnit.toFixed(2)) : 'N/A'}</td>
                </tr>
            `;
        })
        .join('');

    planTable.innerHTML = `
        <thead>
            <tr>
                <th>Source</th>
                <th>Category</th>
                <th>Days</th>
                <th>Purchases</th>
                <th>Units Gained</th>
                <th>Cost (Banknotes)</th>
                <th>Banknotes / Unit</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    `;

    // Fill in the item-image + source-name cell for each row (kept out of the template
    // string above since createItemImage() builds a real DOM node, not markup).
    planTable.querySelectorAll('tbody tr').forEach((tr, index) => {
        const cell = tr.querySelector('.item-cell');
        const { source } = result.plan[index];
        const img = createItemImage(targetItemId, source.name, 'item-icon item-icon--sm');
        cell.appendChild(img);
        cell.appendChild(document.createTextNode(source.name));
    });

    let summary = `Total estimated cost: ${result.totalCost} Banknotes.`;
    if (!result.fullyReachable) {
        summary += ` Warning: target quantity not fully reachable using known sources within purchase limits. Missing ~${result.remaining} unit(s).`;
    }
    planSummary.textContent = summary;
}

function syncUrlParams() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();

    const itemId = itemSelect?.value;
    const shopId = shopSelect?.value;
    const quantity = quantityInput?.value?.trim();
    const limit = ignoreLimitSelect?.value;

    if (itemId) {
        params.set('item', itemId);
    }
    if (shopId) {
        params.set('shop', shopId);
    }
    if (quantity && Number(quantity) > 0) {
        params.set('quantity', quantity);
    }
    if (limit && limit !== '0') {
        params.set('limit', limit);
    }

    const queryString = params.toString();
    const newUrl = `${url.pathname}${queryString ? `?${queryString}` : ''}${url.hash}`;
    window.history.replaceState(null, '', newUrl);
}

function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const itemParam = params.get('item');
    const shopParam = params.get('shop');
    const quantityParam = params.get('quantity') || params.get('amount');
    const limitParam = params.get('limit') || params.get('ignoreLimit');

    if (itemParam && data?.items?.[itemParam]) {
        itemSelect.value = itemParam;
    }
    if (shopParam) {
        if (shopParam === 'any' || data?.exchange_shops?.[shopParam]) {
            shopSelect.value = shopParam;
        } else {
            shopSelect.value = '';
        }
    } else {
        shopSelect.value = '';
    }
    if (quantityParam && Number(quantityParam) > 0) {
        quantityInput.value = quantityParam;
    } else {
        quantityInput.value = '';
    }
    if (limitParam && ['0', '1', '2', '3'].includes(limitParam)) {
        ignoreLimitSelect.value = limitParam;
    } else {
        ignoreLimitSelect.value = '0';
    }
}

function recalculate({ syncUrl = true } = {}) {
    if (!data) {
        return;
    }

    const targetItemId = itemSelect ? itemSelect.value : '';
    const selectedShopId = shopSelect ? shopSelect.value : '';
    const ignoreLevel = Number(ignoreLimitSelect ? ignoreLimitSelect.value : 0) || 0;
    const targetQuantity = Number(quantityInput ? quantityInput.value : 0) || 0;

    if (syncUrl) {
        syncUrlParams();
    }

    if (!targetItemId) {
        sourcesCard.hidden = true;
        planCard.hidden = true;
        return;
    }

    const { items, packages = {}, exchange_shops: exchangeShops = {} } = data;

    const getItemCost = buildItemCostResolver(packages, exchangeShops, items);
    const packageSources = collectPackageSources(targetItemId, packages, items, ignoreLevel);
    let activeShops = {};
    if (selectedShopId === 'any') {
        activeShops = exchangeShops;
    } else if (selectedShopId && exchangeShops[selectedShopId]) {
        activeShops = { [selectedShopId]: exchangeShops[selectedShopId] };
    }
    const exchangeSources = collectExchangeSources(targetItemId, activeShops, items, getItemCost, ignoreLevel);

    const allSources = [...packageSources, ...exchangeSources].filter((s) => Number.isFinite(s.pricePerUnit));

    sourcesCard.hidden = false;
    if (allSources.length === 0) {
        sourcesTable.innerHTML = '';
        sourcesEmpty.hidden = false;
        planCard.hidden = true;
        return;
    }

    sourcesEmpty.hidden = true;
    renderSourcesTable(allSources);

    if (targetQuantity > 0) {
        const result = buildPurchasePlan(allSources, targetQuantity);
        planCard.hidden = false;
        renderPlanTable(result, targetItemId);
    } else {
        planCard.hidden = true;
    }
}

function handleReset() {
    if (itemSelect && itemSelect.options.length > 0) {
        itemSelect.selectedIndex = 0;
    }
    if (shopSelect) {
        shopSelect.value = '';
    }
    if (quantityInput) {
        quantityInput.value = '';
    }
    if (ignoreLimitSelect) {
        ignoreLimitSelect.value = '0';
    }

    const url = new URL(window.location.href);
    window.history.replaceState(null, '', url.pathname + url.hash);
    recalculate({ syncUrl: false });
}

async function init() {
    data = await loadPackData();
    populateItemSelect(data.items || {});
    populateShopSelect(data.exchange_shops || {});
    applyUrlParams();

    if (itemSelect) {
        itemSelect.addEventListener('change', () => recalculate());
    }
    if (shopSelect) {
        shopSelect.addEventListener('change', () => recalculate());
    }
    if (quantityInput) {
        quantityInput.addEventListener('input', () => recalculate());
        quantityInput.addEventListener('change', () => recalculate());
    }
    if (ignoreLimitSelect) {
        ignoreLimitSelect.addEventListener('change', () => recalculate());
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', handleReset);
    }
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            recalculate();
        });
    }
    window.addEventListener('popstate', () => {
        applyUrlParams();
        recalculate({ syncUrl: false });
    });

    recalculate({ syncUrl: false });
}

init().catch((error) => {
    console.error(error);
    document
        .querySelector('main')
        .insertAdjacentHTML(
            'afterbegin',
            `<div class="card"><p class="text-bad">Failed to load data: ${error.message}</p></div>`,
        );
});
