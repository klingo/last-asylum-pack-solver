import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildRanking } from './lib/ranking-core';
import { createItemImage, banknoteIconHtml } from './lib/images';

renderNav('rankings');

const searchInput = document.getElementById('search-input');
const typeFilterGroup = document.getElementById('type-filter-group');
const typeFilterCheckboxes = Array.from(typeFilterGroup.querySelectorAll('input[type="checkbox"]'));
const rankingMeta = document.getElementById('ranking-meta');
const rankingTable = document.getElementById('ranking-table');
const rankingEmpty = document.getElementById('ranking-empty');

let rankings = [];
let itemsById = {};

const TYPE_LABELS = {
    package: 'Package',
    exchange_offer: 'Exchange offer',
    bonus_tier: 'Bonus tier',
};

function matchesFilters(entry, search, types) {
    if (!types.includes(entry.type)) {
        return false;
    }
    if (!search) {
        return true;
    }
    const haystack = `${entry.name} ${entry.category}`.toLowerCase();
    return haystack.includes(search);
}

function goldenBanknotes(text) {
    return text.replace(
        /([\d.,]+)\s*Banknotes/g,
        (match, amount) => `<span class="text-gold">${amount}</span> ${banknoteIconHtml()}`,
    );
}

function breakdownRowsHtml(entry) {
    return entry.contains_breakdown
        .map(
            (item) => `
                <div class="ranking-grid__row">
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell item-cell"><span class="breakdown-icon" data-item-id="${item.item_id}"></span>${item.name} &times;${item.quantity}</div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell">${itemsById[item.item_id]?.category || '-'}</div>
                    <div class="ranking-grid__cell">${item.unit_cost !== null ? `<span class="text-gold">${Number(item.unit_cost.toFixed(4))}</span> ${banknoteIconHtml()}` : 'Unknown'}</div>
                    <div class="ranking-grid__cell"><span class="text-gold">${item.value}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell"></div>
                </div>
            `,
        )
        .join('');
}

function renderTable(filtered) {
    if (filtered.length === 0) {
        rankingTable.innerHTML = '';
        rankingEmpty.hidden = false;
        return;
    }
    rankingEmpty.hidden = true;

    // Both the ranking rows and the nested "Details" breakdown below share the same
    // `.ranking-grid` column tracks (the breakdown uses `grid-template-columns: subgrid`), so
    // their columns always stay visually aligned instead of living in two separate tables.
    const rows = filtered
        .map((entry) => {
            // Pick the breakdown item that contributes the most value as the "main" icon for
            // this entry, rather than just the first one in `contains` (which is very often a
            // generic currency like Diamonds, since it's usually listed first).
            const mainItemId = [...entry.contains_breakdown].sort((a, b) => b.value - a.value)[0]?.item_id || entry.id;
            return `
                <div class="ranking-grid__row" role="row" data-rank="${entry.rank}">
                    <div class="ranking-grid__cell" role="cell">${entry.rank}</div>
                    <div class="ranking-grid__cell item-cell" role="cell"><span class="main-icon" data-item-id="${mainItemId}"></span>${entry.name}</div>
                    <div class="ranking-grid__cell" role="cell"><span class="pill pill--${entry.type}">${TYPE_LABELS[entry.type] || entry.type}</span></div>
                    <div class="ranking-grid__cell" role="cell">${entry.category}</div>
                    <div class="ranking-grid__cell" role="cell">${goldenBanknotes(entry.price_display)}</div>
                    <div class="ranking-grid__cell" role="cell"><span class="text-gold">${entry.total_value}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell" role="cell">${entry.value_ratio}</div>
                    <div class="ranking-grid__cell" role="cell">${entry.value_complete ? '<span class="text-good">Yes</span>' : '<span class="text-bad">No</span>'}</div>
                    <div class="ranking-grid__cell" role="cell"><button type="button" class="expand-toggle" data-rank="${entry.rank}">Details</button></div>
                </div>
                <div class="ranking-grid__details" data-rank-details="${entry.rank}" hidden>
                    <div class="ranking-grid__row">
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">Item</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">Category</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">Unit Cost</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">Value</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                    </div>
                    ${breakdownRowsHtml(entry)}
                </div>
            `;
        })
        .join('');

    rankingTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">Rank</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">Name</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">Type</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">Category</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">Price</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">Value (${banknoteIconHtml()})</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">Value Ratio</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">Complete</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}
    `;

    // Populate item images (real DOM nodes, can't be inlined into the HTML string above).
    rankingTable.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        const img = createItemImage(itemId, itemId, 'item-icon item-icon--sm');
        placeholder.replaceWith(img);
    });

    rankingTable.querySelectorAll('.expand-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const rank = button.getAttribute('data-rank');
            const detailsSection = rankingTable.querySelector(`[data-rank-details="${rank}"]`);
            const isHidden = detailsSection.hidden;
            detailsSection.hidden = !isHidden;
            button.textContent = isHidden ? 'Hide' : 'Details';
        });
    });
}

function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    const types = typeFilterCheckboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
    const filtered = rankings.filter((entry) => matchesFilters(entry, search, types));
    renderTable(filtered);
}

async function init() {
    const data = await loadPackData();
    itemsById = data.items || {};
    const result = buildRanking(data);
    rankings = result.rankings || [];
    const meta = result.metadata || {};
    rankingMeta.textContent = `${meta.entry_count ?? rankings.length} entries. Generated ${
        meta.generated_at ? new Date(meta.generated_at).toLocaleString() : 'unknown time'
    }. ${meta.note || ''}`;

    searchInput.addEventListener('input', applyFilters);
    typeFilterCheckboxes.forEach((checkbox) => checkbox.addEventListener('change', applyFilters));

    applyFilters();
}

init().catch((error) => {
    console.error(error);
    document
        .querySelector('main')
        .insertAdjacentHTML(
            'afterbegin',
            `<div class="card"><p class="text-bad">Failed to load ranking data: ${error.message}</p></div>`,
        );
});
