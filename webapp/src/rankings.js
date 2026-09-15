import './style.css';
import { renderNav } from './nav';
import { loadValueRanking } from './lib/data';
import { createItemImage } from './lib/images';

renderNav('rankings');

const searchInput = document.getElementById('search-input');
const typeFilter = document.getElementById('type-filter');
const rankingMeta = document.getElementById('ranking-meta');
const rankingTable = document.getElementById('ranking-table');
const rankingEmpty = document.getElementById('ranking-empty');

let rankings = [];

const TYPE_LABELS = {
    package: 'Package',
    exchange_offer: 'Exchange offer',
    bonus_tier: 'Bonus tier',
};

function matchesFilters(entry, search, type) {
    if (type && entry.type !== type) {
        return false;
    }
    if (!search) {
        return true;
    }
    const haystack = `${entry.name} ${entry.category}`.toLowerCase();
    return haystack.includes(search);
}

function breakdownRowsHtml(entry) {
    return entry.contains_breakdown
        .map(
            (item) => `
                <tr>
                    <td class="item-cell"><span class="breakdown-icon" data-item-id="${item.item_id}"></span>${item.name}</td>
                    <td>${item.quantity}</td>
                    <td>${item.unit_cost !== null ? Number(item.unit_cost.toFixed(4)) : 'Unknown'}</td>
                    <td>${item.value}</td>
                </tr>
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

    const rows = filtered
        .map((entry) => {
            const mainItemId = entry.contains_breakdown[0]?.item_id || entry.id;
            return `
                <tr class="ranking-row" data-rank="${entry.rank}">
                    <td>${entry.rank}</td>
                    <td class="item-cell"><span class="main-icon" data-item-id="${mainItemId}"></span>${entry.name}</td>
                    <td><span class="pill pill--${entry.type}">${TYPE_LABELS[entry.type] || entry.type}</span></td>
                    <td>${entry.category}</td>
                    <td>${entry.price_display}</td>
                    <td>${entry.total_value}</td>
                    <td>${entry.value_ratio}</td>
                    <td>${entry.value_complete ? '<span class="text-good">Yes</span>' : '<span class="text-bad">No</span>'}</td>
                    <td><button type="button" class="expand-toggle" data-rank="${entry.rank}">Details</button></td>
                </tr>
                <tr class="expand-row" data-rank-details="${entry.rank}" hidden>
                    <td colspan="9">
                        <div class="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Item</th>
                                        <th>Quantity</th>
                                        <th>Unit Cost</th>
                                        <th>Value</th>
                                    </tr>
                                </thead>
                                <tbody>${breakdownRowsHtml(entry)}</tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            `;
        })
        .join('');

    rankingTable.innerHTML = `
        <thead>
            <tr>
                <th>Rank</th>
                <th>Name</th>
                <th>Type</th>
                <th>Category</th>
                <th>Price</th>
                <th>Value (Banknotes)</th>
                <th>Value Ratio</th>
                <th>Complete</th>
                <th></th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
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
            const detailsRow = rankingTable.querySelector(`[data-rank-details="${rank}"]`);
            const isHidden = detailsRow.hidden;
            detailsRow.hidden = !isHidden;
            button.textContent = isHidden ? 'Hide' : 'Details';
        });
    });
}

function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    const type = typeFilter.value;
    const filtered = rankings.filter((entry) => matchesFilters(entry, search, type));
    renderTable(filtered);
}

async function init() {
    const result = await loadValueRanking();
    rankings = result.rankings || [];
    const meta = result.metadata || {};
    rankingMeta.textContent = `${meta.entry_count ?? rankings.length} entries. Generated ${
        meta.generated_at ? new Date(meta.generated_at).toLocaleString() : 'unknown time'
    }. ${meta.note || ''}`;

    searchInput.addEventListener('input', applyFilters);
    typeFilter.addEventListener('change', applyFilters);

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
