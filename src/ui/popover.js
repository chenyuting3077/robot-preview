/** Toolbar buttons that open a menu or panel below them, shared by the robot and the Mesh & Splat views. Usage: bindPopover(button, panel, onOpen) */
const closers = new Map();

export const closePopover = panel => closers.get(panel)?.();

export function bindPopover(button, panel, onOpen) {
    const close = () => {
        panel.classList.remove('open');
        button.classList.remove('active');
        button.setAttribute('aria-expanded', 'false');
    };
    closers.set(panel, close);
    button.addEventListener('click', () => {
        if (panel.classList.contains('open')) return close();
        panel.classList.add('open');
        button.classList.add('active');
        button.setAttribute('aria-expanded', 'true');
        panel.style.left = '';
        onOpen?.();
        // A button near the right edge, as in a narrow editor pane, opened its panel partly off screen.
        const over = panel.getBoundingClientRect().right - (window.innerWidth - 8);
        if (over > 0) panel.style.left = `${panel.offsetLeft - over}px`;
    });
    document.addEventListener('click', event => {
        if (!panel.contains(event.target) && !button.contains(event.target)) close();
    });
}

// The up menu's buttons stand for the hidden #up-select, which the views read and listen to.
export function bindUpMenu() {
    const select = document.getElementById('up-select');
    const show = () => {
        document.getElementById('up-label').textContent = select.value;
        document.querySelectorAll('[data-up]').forEach(button => button.classList.toggle('active', button.dataset.up === select.value));
    };
    show();
    select.addEventListener('change', show);
    document.querySelectorAll('[data-up]').forEach(button => button.addEventListener('click', () => {
        closePopover(document.getElementById('up-menu'));
        if (select.value === button.dataset.up) return;
        select.value = button.dataset.up;
        select.dispatchEvent(new Event('change'));
    }));
}
