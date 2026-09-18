/**
 * Small checkbox-based multi-select dropdown: a toggle button showing a summary of the
 * current selection, opening a checkbox listbox panel underneath. Used where zero, one, or
 * several options can be active at once (unlike a native <select>, which needs ctrl/cmd-click
 * for multiple values and always shows something as "selected").
 */
function createMultiSelect({ button, panel, onChange, emptyLabel, countLabel }) {
    let options = []; // [{ id, label }]
    let selected = new Set();

    function isOpen() {
        return !panel.hidden;
    }

    function open() {
        if (options.length === 0) {
            return;
        }
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
    }

    function close() {
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }

    function updateButtonLabel() {
        button.textContent = selected.size === 0 ? emptyLabel() : countLabel(selected.size);
    }

    function renderPanel() {
        panel.innerHTML = '';
        for (const option of options) {
            const label = document.createElement('label');
            label.className = 'multi-select__option';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selected.has(option.id);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selected.add(option.id);
                } else {
                    selected.delete(option.id);
                }
                updateButtonLabel();
                onChange?.(new Set(selected));
            });
            label.appendChild(checkbox);
            const text = document.createElement('span');
            text.textContent = option.label;
            label.appendChild(text);
            panel.appendChild(label);
        }
    }

    button.addEventListener('click', () => {
        if (isOpen()) {
            close();
        } else {
            open();
        }
    });

    button.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            close();
        }
    });

    // The wrapper element (button + panel) is used for the outside-click check, mirroring
    // lib/item-picker.js.
    const container = button.parentElement;

    document.addEventListener('click', (event) => {
        if (isOpen() && !container.contains(event.target)) {
            close();
        }
    });

    return {
        setOptions(newOptions) {
            options = newOptions;
            // Drop any selected id that no longer exists (e.g. after a data reload).
            const validIds = new Set(options.map((option) => option.id));
            selected = new Set([...selected].filter((id) => validIds.has(id)));
            updateButtonLabel();
            renderPanel();
        },
        getValues() {
            return new Set(selected);
        },
        setValues(ids) {
            const validIds = new Set(options.map((option) => option.id));
            selected = new Set(ids.filter((id) => validIds.has(id)));
            updateButtonLabel();
            renderPanel();
        },
        reset() {
            selected = new Set();
            updateButtonLabel();
            renderPanel();
        },
    };
}

export { createMultiSelect };
