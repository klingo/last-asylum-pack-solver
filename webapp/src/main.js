import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { createMarket, collectPackageSources, collectExchangeSources, formatDays } from './lib/pricing-core';
import { buildPurchasePlan } from './lib/purchase-plan';
import { createItemImage } from './lib/images';

renderNav('analyze');

const itemSelect = document.getElementById('item-select');
const shopSelect = document.getElementById('shop-select');
const quantityInput = document.getElementById('quantity-input');
const daysInput = document.getElementById('days-input');
const ignoreDailyCheckbox = document.getElementById('ignore-daily-checkbox');
const ignoreWeeklyCheckbox = document.getElementById('ignore-weekly-checkbox');
const ignoreMonthlyCheckbox = document.getElementById('ignore-monthly-checkbox');
const resetBtn = document.getElementById('reset-btn');
const form = document.getElementById('analyze-form');

const sourcesCard = document.getElementById('sources-card');
const sourcesTable = document.getElementById('sources-table');
const sourcesEmpty = document.getElementById('sources-empty');
const planCard = document.getElementById('plan-card');
const planTable = document.getElementById('plan-table');
const planSummary = document.getElementById('plan-summary');
const planWarning = document.getElementById('plan-warning');

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
            const priceCell =
                source.type === 'exchange'
                    ? source.priceDisplay
                    : `<span class="text-gold">${source.price} Banknotes</span>`;
            const limitCell = Number.isFinite(source.purchaseCapacity)
                ? Number((source.purchaseCapacity * source.yieldPerPurchase).toFixed(2))
                : 'Unlimited';
            const pillClass = source.type === 'exchange' ? 'pill--exchange_offer' : `pill--${source.type}`;
            const typeLabel = TYPE_LABELS[source.type] || source.type;
            const requiresDisplay = getResolvedRequiresName(source.requires, data?.packages || {}, data?.items || {});
            const pricePerUnitCell = Number.isFinite(source.pricePerUnit)
                ? `<span class="text-gold">${Number(source.pricePerUnit.toFixed(2))}</span>`
                : 'N/A';

            return `
                <tr>
                    <td><span class="pill ${pillClass}">${typeLabel}</span></td>
                    <td>${source.name}</td>
                    <td>${source.category || '-'}</td>
                    <td>${priceCell}</td>
                    <td>${Number(source.yieldPerPurchase.toFixed(4))}</td>
                    <td>${pricePerUnitCell}</td>
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

function detailsRowsHtml(details) {
    return details
        .map(
            (detail) => `
                <div class="plan-grid__row">
                    <div class="plan-grid__cell">${detail.source.name}</div>
                    <div class="plan-grid__cell">${detail.source.category || '-'}</div>
                    <div class="plan-grid__cell">${formatDays(detail.source.availableDays)}</div>
                    <div class="plan-grid__cell">${detail.purchases}</div>
                    <div class="plan-grid__cell">${detail.unitsGained}</div>
                    <div class="plan-grid__cell"><span class="text-gold">${detail.cost}</span></div>
                </div>
            `,
        )
        .join('');
}

function renderPlanTable(result, targetItemId) {
    if (result.plan.length === 0) {
        planTable.innerHTML = '';
        planSummary.textContent = 'No purchasable sources found for this item.';
        planWarning.hidden = true;
        planWarning.textContent = '';
        return;
    }

    // Both the plan rows and the nested "Details" breakdown below share the same
    // `.plan-grid` column tracks (the breakdown uses `grid-template-columns: subgrid`), so
    // their columns always stay visually aligned instead of living in two separate tables.
    const rows = result.plan
        .map(({ source, purchases, unitsGained, cost, details }, index) => {
            const hasDetails = source.type === 'exchange' && details && details.length > 0;
            const detailsCell = hasDetails
                ? `<button type="button" class="expand-toggle" data-plan-index="${index}">Details</button>`
                : '';

            const detailsSection = hasDetails
                ? `
                <div class="plan-grid__details" data-plan-details="${index}" hidden>
                    <p class="plan-grid__details-intro">
                        Shop packages needed to buy the ${source.name.split(' - ')[1] || 'required'} currency for this row:
                    </p>
                    <div class="plan-grid__row">
                        <div class="plan-grid__cell plan-grid__cell--header">Package</div>
                        <div class="plan-grid__cell plan-grid__cell--header">Category</div>
                        <div class="plan-grid__cell plan-grid__cell--header">Days</div>
                        <div class="plan-grid__cell plan-grid__cell--header">Purchases</div>
                        <div class="plan-grid__cell plan-grid__cell--header">Units Gained</div>
                        <div class="plan-grid__cell plan-grid__cell--header">Cost (Banknotes)</div>
                    </div>
                    ${detailsRowsHtml(details)}
                </div>
            `
                : '';

            return `
                <div class="plan-grid__row" role="row">
                    <div class="plan-grid__cell item-cell" role="cell"></div>
                    <div class="plan-grid__cell" role="cell">${source.category || '-'}</div>
                    <div class="plan-grid__cell" role="cell">${formatDays(source.availableDays)}</div>
                    <div class="plan-grid__cell" role="cell">${purchases}</div>
                    <div class="plan-grid__cell" role="cell">${unitsGained}</div>
                    <div class="plan-grid__cell" role="cell"><span class="text-gold">${cost}</span></div>
                    <div class="plan-grid__cell" role="cell">${Number.isFinite(source.pricePerUnit) ? `<span class="text-gold">${Number(source.pricePerUnit.toFixed(2))}</span>` : 'N/A'}</div>
                    <div class="plan-grid__cell" role="cell">${detailsCell}</div>
                </div>
                ${detailsSection}
            `;
        })
        .join('');

    planTable.innerHTML = `
        <div class="plan-grid__row" role="row">
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">Source</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">Category</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">Days</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">Purchases</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">Units Gained</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">Cost (Banknotes)</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">Banknotes / Unit</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}
    `;

    // Fill in the item-image + source-name cell for each row (kept out of the template
    // string above since createItemImage() builds a real DOM node, not markup). Scoped to
    // direct children of the grid so the nested "Details" breakdown rows (which reuse the
    // same `.plan-grid__row`/`.plan-grid__cell` classes, just further down the subtree)
    // aren't counted here.
    planTable.querySelectorAll(':scope > .plan-grid__row').forEach((row, index) => {
        // index 0 is the header row; plan rows start at index 1.
        if (index === 0) {
            return;
        }
        const cell = row.querySelector('.item-cell');
        const { source } = result.plan[index - 1];
        const img = createItemImage(targetItemId, source.name, 'item-icon item-icon--sm');
        cell.appendChild(img);
        cell.appendChild(document.createTextNode(source.name));
    });

    planTable.querySelectorAll('.expand-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const idx = button.getAttribute('data-plan-index');
            const detailsSection = planTable.querySelector(`[data-plan-details="${idx}"]`);
            const isHidden = detailsSection.hidden;
            detailsSection.hidden = !isHidden;
            button.textContent = isHidden ? 'Hide' : 'Details';
        });
    });

    planSummary.innerHTML = `Total estimated cost: <span class="text-gold">${result.totalCost}</span> Banknotes.`;
    if (!result.fullyReachable) {
        planWarning.textContent = `Warning: target quantity not fully reachable using known sources within purchase limits. Missing ~${result.remaining} unit(s).`;
        planWarning.hidden = false;
    } else {
        planWarning.textContent = '';
        planWarning.hidden = true;
    }
}

function syncUrlParams() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();

    const itemId = itemSelect?.value;
    const shopId = shopSelect?.value;
    const quantity = quantityInput?.value?.trim();
    const days = daysInput?.value?.trim();

    if (itemId) {
        params.set('item', itemId);
    }
    if (shopId) {
        params.set('shop', shopId);
    }
    if (quantity && Number(quantity) > 0) {
        params.set('quantity', quantity);
    }
    if (days && Number(days) > 1) {
        params.set('days', days);
    }
    if (ignoreDailyCheckbox?.checked) {
        params.set('ignoreDaily', '1');
    }
    if (ignoreWeeklyCheckbox?.checked) {
        params.set('ignoreWeekly', '1');
    }
    if (ignoreMonthlyCheckbox?.checked) {
        params.set('ignoreMonthly', '1');
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
    const daysParam = params.get('days');

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
    if (daysParam && Number(daysParam) >= 1) {
        daysInput.value = String(Math.floor(Number(daysParam)));
    } else {
        daysInput.value = '1';
    }
    if (ignoreDailyCheckbox) {
        ignoreDailyCheckbox.checked = params.get('ignoreDaily') === '1';
    }
    if (ignoreWeeklyCheckbox) {
        ignoreWeeklyCheckbox.checked = params.get('ignoreWeekly') === '1';
    }
    if (ignoreMonthlyCheckbox) {
        ignoreMonthlyCheckbox.checked = params.get('ignoreMonthly') === '1';
    }
}

function recalculate({ syncUrl = true } = {}) {
    if (!data) {
        return;
    }

    const targetItemId = itemSelect ? itemSelect.value : '';
    const selectedShopId = shopSelect ? shopSelect.value : '';
    const limitOptions = {
        ignoreDaily: Boolean(ignoreDailyCheckbox?.checked),
        ignoreWeekly: Boolean(ignoreWeeklyCheckbox?.checked),
        ignoreMonthly: Boolean(ignoreMonthlyCheckbox?.checked),
        days: Number(daysInput ? daysInput.value : 1) || 1,
    };
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

    // The market always sees every package/exchange shop, since the "Active Exchange Shop"
    // selection only restricts which shop may sell the target item *directly*; the currency
    // needed to pay for any exchange offer (target item or otherwise) can still come from
    // any shop. A fresh market is created per recalculation so purchase-limit capacities
    // start out unconsumed.
    const market = createMarket(packages, exchangeShops, items, limitOptions);

    const packageSources = collectPackageSources(targetItemId, packages, items, limitOptions);
    let activeShops = {};
    let shopFilter = new Set();
    if (selectedShopId === 'any') {
        activeShops = exchangeShops;
        shopFilter = null;
    } else if (selectedShopId && exchangeShops[selectedShopId]) {
        activeShops = { [selectedShopId]: exchangeShops[selectedShopId] };
        shopFilter = new Set([selectedShopId]);
    }
    const exchangeSources = collectExchangeSources(targetItemId, activeShops, items, market.peekUnitCost, limitOptions);

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
        const result = buildPurchasePlan(market, targetItemId, targetQuantity, shopFilter);
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
    if (daysInput) {
        daysInput.value = '1';
    }
    if (ignoreDailyCheckbox) {
        ignoreDailyCheckbox.checked = false;
    }
    if (ignoreWeeklyCheckbox) {
        ignoreWeeklyCheckbox.checked = false;
    }
    if (ignoreMonthlyCheckbox) {
        ignoreMonthlyCheckbox.checked = false;
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
    if (daysInput) {
        daysInput.addEventListener('input', () => recalculate());
        daysInput.addEventListener('change', () => recalculate());
    }
    if (ignoreDailyCheckbox) {
        ignoreDailyCheckbox.addEventListener('change', () => recalculate());
    }
    if (ignoreWeeklyCheckbox) {
        ignoreWeeklyCheckbox.addEventListener('change', () => recalculate());
    }
    if (ignoreMonthlyCheckbox) {
        ignoreMonthlyCheckbox.addEventListener('change', () => recalculate());
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
