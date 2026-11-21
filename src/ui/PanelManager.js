/**
 * A panel the user has not touched keeps its CSS place, which follows the
 * window. The saved layout is the user's intent and the window size never
 * changes it; only what is shown is clamped, so a panel that had to shrink in a
 * small window grows back in a bigger one.
 */

const MIN_WIDTH = 280;
const MIN_HEIGHT = 100;
// The graph's padding leaves 12 px around the SVG, so a border this wide
// never overlaps the graph's pan area.
const BORDER = 8;
const SNAP_ZONE = 24;
// Same gap as the panels' default places and the maximized tree panel.
const MARGIN = 20;
const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

function view() {
    const toolbar = document.getElementById('top-control-bar');
    return { width: window.innerWidth, height: window.innerHeight, top: toolbar ? toolbar.getBoundingClientRect().bottom : 0 };
}

// Panels stay below the toolbar (z-index 100), or a header under it could not be grabbed.
export function placement(layout, v = view()) {
    const { dock } = layout;
    let width = clamp(layout.width, MIN_WIDTH, v.width - 2 * MARGIN);
    let height = clamp(layout.height, MIN_HEIGHT, v.height - v.top - 2 * MARGIN);
    let { left, top } = layout;
    if (dock === 'left' || dock === 'right') {
        top = v.top + MARGIN;
        height = Math.max(MIN_HEIGHT, v.height - v.top - 2 * MARGIN);
    } else if (dock?.startsWith('top')) {
        top = v.top + MARGIN;
    } else if (dock?.startsWith('bottom')) {
        top = v.height - MARGIN - height;
    }
    if (dock?.endsWith('left')) left = MARGIN;
    else if (dock?.endsWith('right')) left = v.width - MARGIN - width;
    if (!dock) {
        left = clamp(left, 0, v.width - width);
        top = clamp(top, v.top, v.height - height);
    }
    return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

// Where a header drag released at (x, y) docks; top or bottom alone does not.
export function snapZone(x, y, v = view()) {
    const left = x < SNAP_ZONE, right = x > v.width - SNAP_ZONE;
    const top = y < SNAP_ZONE, bottom = y > v.height - SNAP_ZONE;
    if ((left || right) && (top || bottom)) return `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}`;
    return left ? 'left' : right ? 'right' : null;
}

const validLayout = layout => layout && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(layout[key]));

export class PanelManager {
    constructor() {
        this.panels = new Map();
        this.modelGraphView = null;
        this.savedGraphView = null;
        this.onLayoutChange = null;
        window.addEventListener('resize', () => this.renderAll());
    }

    // Also on toolbar size changes: docks and the top clamp sit below it.
    renderAll() {
        for (const state of this.panels.values()) if (!state.busy) this.render(state, false);
    }

    setModelGraphView(modelGraphView) {
        this.modelGraphView = modelGraphView;
    }

    registerPanel(panelId, headerSelector = '.floating-panel-header') {
        const panel = document.getElementById(panelId);
        const header = panel?.querySelector(headerSelector);
        if (!panel || !header) return;
        const state = { id: panelId, panel, header, layout: null, busy: false };
        this.panels.set(panelId, state);
        this.setupPanelDragAndResize(state);
    }

    initAllPanels() {
        this.registerPanel('floating-joints-panel');
        this.registerPanel('floating-model-tree');
        this.setupMaximizeButtons();
    }

    setLayouts(layouts = {}) {
        for (const [id, state] of this.panels) {
            const layout = layouts[id];
            if (!validLayout(layout)) continue;
            state.layout = { ...layout, dock: layout.dock || null, maximized: !!layout.maximized };
            this.render(state, false);
            this.showMaximized(state);
        }
    }

    render({ panel, layout }, animate = true) {
        if (!layout) return;
        const rect = placement(layout);
        if (!animate) panel.style.transition = 'none';
        Object.assign(panel.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        if (!animate) {
            panel.offsetHeight;
            panel.style.transition = '';
        }
    }

    // Computed left/top, not the bounding rect: during the opening slideIn the
    // rect is 10 px off and would be pinned as the panel's place.
    adopt(state) {
        if (state.layout) return;
        const { panel } = state;
        const style = getComputedStyle(panel);
        state.layout = { left: Math.round(parseFloat(style.left)), top: Math.round(parseFloat(style.top)), width: panel.offsetWidth, height: panel.offsetHeight, dock: null, maximized: false };
        this.render(state, false);
    }

    // Where a gesture starts. Rendering first ends a running transition (restore
    // from maximized, a snap, the show fade), whose in-between rect must not be
    // measured and saved.
    startRect(state) {
        if (state.layout) {
            this.render(state, false);
            return placement(state.layout);
        }
        const style = getComputedStyle(state.panel);
        return { left: parseFloat(style.left), top: parseFloat(style.top), width: state.panel.offsetWidth, height: state.panel.offsetHeight };
    }

    changed(state) {
        this.onLayoutChange?.(state.id, { ...state.layout });
    }

    // Two levels only, so panels never climb over the toolbar (100) and menus.
    bringToFront(panel) {
        document.querySelectorAll('.floating-panel').forEach(p => { p.style.zIndex = p === panel ? 52 : 51; });
    }

    snapPreview(panel) {
        if (!this.preview) {
            this.preview = document.createElement('div');
            this.preview.className = 'panel-snap-preview';
        }
        if (this.preview.parentElement !== panel.parentElement) panel.parentElement.appendChild(this.preview);
        this.preview.style.zIndex = 51;
        return this.preview;
    }

    setupPanelDragAndResize(state) {
        const { panel, header } = state;
        const maximized = () => panel.classList.contains('maximized');

        const edgeAt = (e) => {
            if (maximized()) return null;
            // A scrollbar inside the border stays a scrollbar.
            const target = e.target;
            if (target instanceof Element && target.scrollHeight > target.clientHeight && target !== panel) {
                const box = target.getBoundingClientRect();
                if (e.clientX >= box.left + target.clientLeft + target.clientWidth) return null;
            }
            const r = panel.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            const edge = (y < BORDER ? 'n' : y > r.height - BORDER ? 's' : '') + (x < BORDER ? 'w' : x > r.width - BORDER ? 'e' : '');
            return edge || null;
        };

        const showCursor = (edge) => {
            if (edge) {
                panel.dataset.edge = edge;
                panel.style.setProperty('--edge-cursor', CURSORS[edge]);
            } else {
                delete panel.dataset.edge;
            }
        };

        let resizing = null;
        let dragging = null;
        let frame = null;

        // Capture phase: the border must win over the header's drag and the graph's pan.
        panel.addEventListener('mousemove', (e) => {
            if (!resizing && !dragging) showCursor(edgeAt(e));
        }, true);
        panel.addEventListener('mouseleave', () => {
            if (!resizing) showCursor(null);
        });

        panel.addEventListener('mousedown', (e) => {
            this.bringToFront(panel);
            if (e.button !== 0) return;
            const edge = edgeAt(e);
            if (!edge) return;
            e.preventDefault();
            e.stopPropagation();
            this.adopt(state);
            state.busy = true;
            resizing = { edge, x: e.clientX, y: e.clientY, ...this.startRect(state), last: e };
            showCursor(edge);
            document.documentElement.style.cursor = CURSORS[edge];
            panel.style.transition = 'none';
            document.addEventListener('mousemove', resize);
            document.addEventListener('mouseup', stopResize);
        }, true);

        const resizedRect = () => {
            const { edge, x, y, left, top, width, height, last } = resizing;
            const dx = last.clientX - x, dy = last.clientY - y;
            const v = view();
            const maxWidth = v.width - 2 * MARGIN;
            const rect = { left, top, width, height };
            if (edge.includes('e')) rect.width = clamp(width + dx, MIN_WIDTH, Math.min(maxWidth, v.width - left));
            if (edge.includes('w')) {
                rect.width = clamp(width - dx, MIN_WIDTH, Math.min(maxWidth, left + width));
                rect.left = left + width - rect.width;
            }
            const maxHeight = v.height - v.top - 2 * MARGIN;
            if (edge.includes('s')) rect.height = clamp(height + dy, MIN_HEIGHT, Math.min(maxHeight, v.height - top));
            if (edge.includes('n')) {
                rect.height = clamp(height - dy, MIN_HEIGHT, Math.min(maxHeight, top + height - v.top));
                rect.top = top + height - rect.height;
            }
            return rect;
        };

        const showRect = (rect) => {
            Object.assign(panel.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        };

        // A button released outside the webview sends no mouseup here.
        const resize = (e) => {
            if (e.buttons === 0) return stopResize(resizing.last);
            e.preventDefault();
            resizing.last = e;
            frame ??= requestAnimationFrame(() => {
                frame = null;
                if (resizing) showRect(resizedRect());
            });
        };

        const stopResize = (e) => {
            resizing.last = e;
            const rect = resizedRect();
            const { edge } = resizing;
            const { dock, undocked } = state.layout;
            // Widening a side dock from its free edge keeps it docked.
            const keepDock = (dock === 'left' && edge === 'e') || (dock === 'right' && edge === 'w');
            state.layout = {
                left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height),
                dock: keepDock ? dock : null, ...(keepDock && undocked ? { undocked } : {}), maximized: false
            };
            resizing = null;
            state.busy = false;
            showCursor(null);
            document.documentElement.style.cursor = '';
            this.render(state, false);
            document.removeEventListener('mousemove', resize);
            document.removeEventListener('mouseup', stopResize);
            // The click that follows a resize ending on the panel is not a click on the graph.
            const swallow = event => event.stopPropagation();
            window.addEventListener('click', swallow, true);
            setTimeout(() => window.removeEventListener('click', swallow, true));
            this.changed(state);
        };

        header.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || maximized() || e.target.closest('button, select, input')) return;
            const r = this.startRect(state);
            dragging = {
                x: e.clientX, y: e.clientY, width: r.width, height: r.height, moved: false, zone: null,
                offsetX: clamp(e.clientX - r.left, 0, r.width), offsetY: clamp(e.clientY - r.top, 0, header.offsetHeight)
            };
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', dragEnd);
        });

        const drag = (e) => {
            if (e.buttons === 0) return dragEnd();
            e.preventDefault();
            if (!dragging.moved) {
                if (Math.hypot(e.clientX - dragging.x, e.clientY - dragging.y) < 3) return;
                // Only now: a plain click on the header must not pin the panel's CSS place.
                this.adopt(state);
                state.busy = true;
                dragging.moved = true;
                header.style.cursor = 'grabbing';
                panel.style.transition = 'none';
                // Leaving a dock gives back the size from before docking.
                const { undocked } = state.layout;
                if (state.layout.dock && undocked) {
                    dragging.offsetX *= undocked.width / dragging.width;
                    Object.assign(dragging, undocked);
                    Object.assign(panel.style, { width: `${undocked.width}px`, height: `${undocked.height}px` });
                }
            }
            const left = Math.round(e.clientX - dragging.offsetX), top = Math.round(e.clientY - dragging.offsetY);
            Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });
            Object.assign(dragging, { left, top, zone: snapZone(e.clientX, e.clientY) });

            const preview = this.snapPreview(panel);
            if (dragging.zone) {
                const rect = placement({ ...dragging, dock: dragging.zone });
                Object.assign(preview.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
            } else {
                preview.style.display = 'none';
            }
        };

        const dragEnd = () => {
            document.removeEventListener('mousemove', drag);
            document.removeEventListener('mouseup', dragEnd);
            const { moved, left, top, width, height, zone } = dragging;
            dragging = null;
            if (!moved) return;
            state.busy = false;
            header.style.cursor = '';
            panel.style.transition = '';
            if (this.preview) this.preview.style.display = 'none';
            const size = { width: Math.round(width), height: Math.round(height) };
            state.layout = zone
                ? { left, top, ...size, dock: zone, undocked: size, maximized: false }
                : { ...placement({ left, top, ...size }), dock: null, maximized: false };
            this.render(state);
            this.changed(state);
        };
    }

    showMaximized({ id, panel, layout }) {
        panel.classList.toggle('maximized', !!layout?.maximized);
        const button = document.querySelector(`.panel-maximize-btn[data-panel-id="${id}"]`);
        if (button) button.textContent = layout?.maximized ? '❐' : '⛶';
    }

    setupMaximizeButtons() {
        document.querySelectorAll('.panel-maximize-btn').forEach(button => {
            const state = this.panels.get(button.getAttribute('data-panel-id'));
            if (!state) return;
            button.addEventListener('click', () => {
                this.adopt(state);
                const maximize = !state.panel.classList.contains('maximized');
                state.layout.maximized = maximize;
                this.showMaximized(state);
                this.changed(state);

                // After the panel's 0.4 s transition, so the graph fits the final size.
                if (state.id !== 'floating-model-tree' || !this.modelGraphView) return;
                if (maximize) {
                    this.savedGraphView = this.modelGraphView.saveView();
                    setTimeout(() => this.modelGraphView.fitToView(true, 600), 450);
                } else {
                    const saved = this.savedGraphView;
                    setTimeout(() => this.modelGraphView.restoreView(saved, 600), 450);
                }
            });
        });
    }
}
