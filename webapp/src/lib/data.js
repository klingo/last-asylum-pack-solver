/**
 * Loads the generated data files (copied into public/data by scripts/generate-webapp-data.js
 * as part of the build) that back both pages of the webapp.
 */

async function fetchJson(fileName) {
    const url = `${import.meta.env.BASE_URL}data/${fileName}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${fileName}: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function loadPackData() {
    return fetchJson('pack_data.json');
}

function loadValueRanking() {
    return fetchJson('value_ranking.json');
}

export { fetchJson, loadPackData, loadValueRanking };
