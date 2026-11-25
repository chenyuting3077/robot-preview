/** A toolbar button that opens a menu or panel below it, closed by a click elsewhere. Usage: bindPopover(button, panel, onToggle) */
export function bindPopover(button, panel, onToggle) {
    button.addEventListener('click', () => {
        panel.classList.toggle('open');
        button.classList.toggle('active', panel.classList.contains('open'));
        button.setAttribute('aria-expanded', String(panel.classList.contains('open')));
        panel.style.left = '';
        onToggle?.();
        // A button near the right edge, as in a narrow editor pane, opened its panel partly off screen.
        const over = panel.getBoundingClientRect().right - (window.innerWidth - 8);
        if (over > 0) panel.style.left = `${panel.offsetLeft - over}px`;
    });
    document.addEventListener('click', event => {
        if (panel.contains(event.target) || button.contains(event.target)) return;
        panel.classList.remove('open');
        button.classList.remove('active');
        button.setAttribute('aria-expanded', 'false');
    });
}
