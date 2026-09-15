/**
 * Renders the shared top navigation bar and marks the current page as active.
 */
function renderNav(activePage) {
    const header = document.querySelector('.app-header');
    if (!header) {
        return;
    }
    const base = import.meta.env.BASE_URL;
    header.innerHTML = `
        <h1>Last Asylum Pack Solver</h1>
        <nav class="app-nav">
            <a href="${base}index.html" class="${activePage === 'analyze' ? 'active' : ''}">Analyze Item Value</a>
            <a href="${base}rankings.html" class="${activePage === 'rankings' ? 'active' : ''}">Value Ranking</a>
        </nav>
    `;
}

export { renderNav };
