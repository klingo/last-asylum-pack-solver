import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { createMarket, collectPackageSources, collectExchangeSources } from './lib/pricing-core';
import { buildPurchasePlan } from './lib/purchase-plan';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { createItemPicker } from './lib/item-picker';
import { createMultiSelect } from './lib/multi-select';
import { formatUnitPriceColumn, formatThousands } from './lib/format';
import {
    t,
    getLocale,
    localizedName,
    categoryLabel,
    sourceTypeLabel,
    formatDays,
    applyStaticTranslations,
} from './lib/i18n';

renderNav('analyze');
applyStaticTranslations();

const itemSearchInput = document.getElementById('item-search');
const itemListPanel = document.getElementById('item-listbox');
const itemSearchClearBtn = document.getElementById('item-search-clear');
const itemPicker = createItemPicker({
    input: itemSearchInput,
    panel: itemListPanel,
    clearButton: itemSearchClearBtn,
    onChange: () => recalculate(),
});
const shopSelectButton = document.getElementById('shop-select-button');
const shopSelectPanel = document.getElementById('shop-select-panel');
const shopMultiSelect = createMultiSelect({
    button: shopSelectButton,
    panel: shopSelectPanel,
    emptyLabel: () => t('analyze.shopNoneSelected'),
    countLabel: (count) => t('analyze.shopSelectedCount', { count }),
    onChange: () => recalculate(),
});
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
const appFooter = document.querySelector('.app-footer');

let data = null;

function populateShopSelect(exchangeShops) {
    const sortedShops = Object.entries(exchangeShops).sort((a, b) =>
        localizedName(a[1].name).localeCompare(localizedName(b[1].name)),
    );
    shopMultiSelect.setOptions(sortedShops.map(([shopId, shop]) => ({ id: shopId, label: localizedName(shop.name) })));
}

function getResolvedRequiresName(requiresId, packages, items) {
    if (!requiresId) {
        return t('common.dash');
    }
    return localizedName(packages[requiresId]?.name) || localizedName(items[requiresId]?.name) || requiresId;
}

function renderSourcesTable(sources) {
    const ordered = [...sources].sort((a, b) => a.pricePerUnit - b.pricePerUnit);
    // Every row's "/ Unit" price shares one decimal precision (whatever the smallest value in
    // the column needs to show a non-zero digit) rather than each row rounding independently,
    // so e.g. "1" reads as "1.00" once some other row needs two decimals to not show as "0.00".
    const perUnitDisplay = formatUnitPriceColumn(ordered.map((source) => source.pricePerUnit));

    const rows = ordered
        .map((source, index) => {
            const priceCell =
                source.type === 'exchange'
                    ? source.priceDisplay
                    : `<span class="text-gold">${formatThousands(source.price)}</span> ${banknoteIconHtml()}`;
            const limitCell = Number.isFinite(source.purchaseCapacity)
                ? formatThousands(Number((source.purchaseCapacity * source.yieldPerPurchase).toFixed(2)))
                : t('common.unlimited');
            const pillClass = source.type === 'exchange' ? 'pill--exchange_offer' : `pill--${source.type}`;
            const typeLabel = sourceTypeLabel(source.type);
            const requiresDisplay = getResolvedRequiresName(source.requires, data?.packages || {}, data?.items || {});
            const pricePerUnitCell =
                perUnitDisplay[index] !== null
                    ? `<span class="text-gold">${perUnitDisplay[index]}</span> ${banknoteIconHtml()}`
                    : t('common.notAvailable');

            return `
                <tr>
                    <td><span class="pill ${pillClass}">${typeLabel}</span></td>
                    <td>${source.name}</td>
                    <td>${categoryLabel(source.category)}</td>
                    <td class="text-right">${priceCell}</td>
                    <td class="text-right">${formatThousands(Number(source.yieldPerPurchase.toFixed(4)))}</td>
                    <td class="text-right">${pricePerUnitCell}</td>
                    <td class="text-right">${limitCell}</td>
                    <td>${formatDays(source.availableDays)}</td>
                    <td>${requiresDisplay}</td>
                </tr>
            `;
        })
        .join('');

    sourcesTable.innerHTML = `
        <thead>
            <tr>
                <th>${t('analyze.table.type')}</th>
                <th>${t('analyze.table.source')}</th>
                <th>${t('analyze.table.category')}</th>
                <th class="text-right">${t('analyze.table.pricePerPurchase')}</th>
                <th class="text-right">${t('analyze.table.yieldPerPurchase')}</th>
                <th class="text-right">${t('analyze.table.perUnit', { icon: banknoteIconHtml() })}</th>
                <th class="text-right">${t('analyze.table.limitUnits')}</th>
                <th>${t('analyze.table.days')}</th>
                <th>${t('analyze.table.requires')}</th>
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
                    <div class="plan-grid__cell">${categoryLabel(detail.source.category)}</div>
                    <div class="plan-grid__cell">${formatDays(detail.source.availableDays)}</div>
                    <div class="plan-grid__cell text-right">${detail.purchases}</div>
                    <div class="plan-grid__cell text-right">${formatThousands(detail.unitsGained)}</div>
                    <div class="plan-grid__cell text-right"><span class="text-gold">${formatThousands(detail.cost)}</span> ${banknoteIconHtml()}</div>
                </div>
            `,
        )
        .join('');
}

function renderPlanTable(result, targetItemId) {
    if (result.plan.length === 0) {
        planTable.innerHTML = '';
        planSummary.textContent = t('analyze.planEmpty');
        planWarning.hidden = true;
        planWarning.textContent = '';
        return;
    }

    // Both the plan rows and the nested "Details" breakdown below share the same
    // `.plan-grid` column tracks (the breakdown uses `grid-template-columns: subgrid`), so
    // their columns always stay visually aligned instead of living in two separate tables.
    // The "/ Unit" column shares one decimal precision across all rows (see renderSourcesTable).
    const perUnitDisplay = formatUnitPriceColumn(result.plan.map(({ source }) => source.pricePerUnit));

    const rows = result.plan
        .map(({ source, purchases, unitsGained, cost, details }, index) => {
            const hasDetails = source.type === 'exchange' && details && details.length > 0;
            const detailsCell = hasDetails
                ? `<button type="button" class="expand-toggle" data-plan-index="${index}">${t('common.details')}</button>`
                : '';

            const detailsSection = hasDetails
                ? `
                <div class="plan-grid__details" data-plan-details="${index}" hidden>
                    <p class="plan-grid__details-intro">
                        ${t('analyze.detailsIntro', { currency: source.name.split(' - ')[1] || t('analyze.detailsIntroFallback') })}
                    </p>
                    <div class="plan-grid__row">
                        <div class="plan-grid__cell plan-grid__cell--header">${t('analyze.table.source')}</div>
                        <div class="plan-grid__cell plan-grid__cell--header">${t('analyze.table.category')}</div>
                        <div class="plan-grid__cell plan-grid__cell--header">${t('analyze.table.days')}</div>
                        <div class="plan-grid__cell plan-grid__cell--header text-right">${t('analyze.table.purchases')}</div>
                        <div class="plan-grid__cell plan-grid__cell--header text-right">${t('analyze.table.unitsGained')}</div>
                        <div class="plan-grid__cell plan-grid__cell--header text-right">${t('analyze.table.cost', { icon: banknoteIconHtml() })}</div>
                    </div>
                    ${detailsRowsHtml(details)}
                </div>
            `
                : '';

            return `
                <div class="plan-grid__row" role="row">
                    <div class="plan-grid__cell item-cell" role="cell"></div>
                    <div class="plan-grid__cell" role="cell">${categoryLabel(source.category)}</div>
                    <div class="plan-grid__cell" role="cell">${formatDays(source.availableDays)}</div>
                    <div class="plan-grid__cell text-right" role="cell">${purchases}</div>
                    <div class="plan-grid__cell text-right" role="cell">${formatThousands(unitsGained)}</div>
                    <div class="plan-grid__cell text-right" role="cell"><span class="text-gold">${formatThousands(cost)}</span> ${banknoteIconHtml()}</div>
                    <div class="plan-grid__cell text-right" role="cell">${perUnitDisplay[index] !== null ? `<span class="text-gold">${perUnitDisplay[index]}</span> ${banknoteIconHtml()}` : t('common.notAvailable')}</div>
                    <div class="plan-grid__cell" role="cell">${detailsCell}</div>
                </div>
                ${detailsSection}
            `;
        })
        .join('');

    planTable.innerHTML = `
        <div class="plan-grid__row" role="row">
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">${t('analyze.table.source')}</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">${t('analyze.table.category')}</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">${t('analyze.table.days')}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.purchases')}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.unitsGained')}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.cost', { icon: banknoteIconHtml() })}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.perUnit', { icon: banknoteIconHtml() })}</div>
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
            button.textContent = isHidden ? t('common.hide') : t('common.details');
        });
    });

    planSummary.innerHTML = t('analyze.planSummary', {
        cost: `<span class="text-gold">${formatThousands(result.totalCost)}</span>`,
        icon: banknoteIconHtml(),
    });
    if (!result.fullyReachable) {
        planWarning.textContent = t('analyze.planWarning', { remaining: formatThousands(result.remaining) });
        planWarning.hidden = false;
    } else {
        planWarning.textContent = '';
        planWarning.hidden = true;
    }
}

function syncUrlParams() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();

    const itemId = itemPicker.getValue();
    const shopIds = [...shopMultiSelect.getValues()];
    const quantity = quantityInput?.value?.trim();
    const days = daysInput?.value?.trim();
    const lang = new URLSearchParams(url.search).get('lang');

    if (lang) {
        params.set('lang', lang);
    }
    if (itemId) {
        params.set('item', itemId);
    }
    if (shopIds.length > 0) {
        params.set('shop', shopIds.join(','));
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
        itemPicker.setValue(itemParam);
    }
    const shopIds = shopParam ? shopParam.split(',').filter((id) => data?.exchange_shops?.[id]) : [];
    shopMultiSelect.setValues(shopIds);
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

    const targetItemId = itemPicker.getValue();
    const selectedShopIds = shopMultiSelect.getValues();
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
    const locale = getLocale();

    // Packages tied to an event (e.g. "blades_out_select_pack") only exist while that event's
    // exchange shop is running, so they're gated by the same "Active Exchange Shop" selection:
    // an event is active exactly when one of the currently selected shops carries its
    // event_id (shops without an event_id contribute nothing). No shop selected activates no
    // event at all.
    const activeEventIds = new Set();
    for (const shopId of selectedShopIds) {
        const eventId = exchangeShops[shopId]?.event_id;
        if (eventId) {
            activeEventIds.add(eventId);
        }
    }

    // The market always sees every package/exchange shop, since the "Active Exchange Shop"
    // selection only restricts which shop may sell the target item *directly*; the currency
    // needed to pay for any exchange offer (target item or otherwise) can still come from
    // any shop. A fresh market is created per recalculation so purchase-limit capacities
    // start out unconsumed.
    const market = createMarket(packages, exchangeShops, items, limitOptions, { activeEventIds }, locale);

    const packageSources = collectPackageSources(targetItemId, packages, items, limitOptions, locale, activeEventIds);
    const activeShops = {};
    for (const shopId of selectedShopIds) {
        if (exchangeShops[shopId]) {
            activeShops[shopId] = exchangeShops[shopId];
        }
    }
    const shopFilter = new Set(selectedShopIds);
    const exchangeSources = collectExchangeSources(
        targetItemId,
        activeShops,
        items,
        market.peekUnitCost,
        limitOptions,
        locale,
    );

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
    itemPicker.reset();
    shopMultiSelect.reset();
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
    const lang = new URLSearchParams(url.search).get('lang');
    window.history.replaceState(null, '', `${url.pathname}${lang ? `?lang=${lang}` : ''}${url.hash}`);
    recalculate({ syncUrl: false });
}

function updateFooter() {
    if (!appFooter) {
        return;
    }
    appFooter.textContent = data?.metadata?.last_updated
        ? t('footer.analyzeGenerated', { date: data.metadata.last_updated })
        : t('footer.analyzeDefault');
}

async function init() {
    data = await loadPackData();
    updateFooter();
    itemPicker.setItems(data.items || {});
    populateShopSelect(data.exchange_shops || {});
    applyUrlParams();

    window.addEventListener('localechange', () => {
        const selectedShopIds = [...shopMultiSelect.getValues()];
        applyStaticTranslations();
        updateFooter();
        // Re-affirms the currently selected item's display text in the new locale; both
        // pickers keep their own selection state across a setItems()/setOptions() call, unlike
        // a native <select> whose value resets when its <option>s are replaced (hence the
        // shop capture/restore just below still being necessary).
        itemPicker.setItems(data.items || {});
        populateShopSelect(data.exchange_shops || {});
        shopMultiSelect.setValues(selectedShopIds);
        recalculate({ syncUrl: false });
    });

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
            `<div class="card"><p class="text-bad">${t('common.loadError', { message: error.message })}</p></div>`,
        );
});
