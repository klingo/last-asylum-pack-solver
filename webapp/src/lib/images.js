/**
 * Item image handling. No real item images exist yet, so this simply establishes the
 * convention (assets/items/<item_id>.png) and a graceful fallback to a placeholder icon,
 * so images can be dropped in later without touching any rendering code.
 */

const PLACEHOLDER_ICON = `${import.meta.env.BASE_URL}icons/placeholder-item.svg`;

function getItemImageUrl(itemId) {
    return `${import.meta.env.BASE_URL}assets/items/${itemId}.png`;
}

/**
 * Creates an <img> element for the given item id, pre-wired to fall back to the
 * placeholder icon if the real image doesn't exist (which is currently always the case).
 */
function createItemImage(itemId, altText, className = 'item-icon') {
    const img = document.createElement('img');
    img.src = getItemImageUrl(itemId);
    img.alt = altText || itemId;
    img.className = className;
    img.loading = 'lazy';
    img.onerror = () => {
        img.onerror = null;
        img.src = PLACEHOLDER_ICON;
        img.classList.add('item-icon--placeholder');
    };
    return img;
}

export { getItemImageUrl, createItemImage, PLACEHOLDER_ICON };
