/**
 * Loads the raw pack data (copied into public/data by scripts/copy-pack-data.js as part of
 * the build) that backs both pages of the webapp. All analysis/ranking is computed live in
 * the browser from this file; no pre-generated ranking/index files are involved.
 */
import { t } from './i18n';

async function fetchJson(fileName) {
    const url = `${import.meta.env.BASE_URL}data/${fileName}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            t('common.fetchError', { file: fileName, status: response.status, statusText: response.statusText }),
        );
    }
    return response.json();
}

function loadPackData() {
    return fetchJson('pack_data.json');
}

export { fetchJson, loadPackData };
