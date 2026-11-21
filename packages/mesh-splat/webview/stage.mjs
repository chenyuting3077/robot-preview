
const $ = id => document.getElementById(id);
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// `onSelect` gets the prim a row's name was clicked on; select() marks a prim (or none) in the tree and shows its path.
export function buildStage(group, { onSelect = () => {} } = {}) {
    document.querySelector('.stage-head span:last-child').innerHTML = EYE;
    const prims = object => object.children.filter(child => !child.userData.splat);
    const expanded = new Set();
    let selected = null;
    const render = () => {
        const rows = [];
        const walk = (object, depth, inheritedOff) => prims(object).forEach(child => {
            const children = prims(child);
            const row = document.createElement('div');
            row.className = `prim-row${child.visible ? '' : ' off'}${inheritedOff ? ' inherited' : ''}${child === selected ? ' selected' : ''}`;
            const name = document.createElement('div');
            name.className = 'prim-name';
            name.style.paddingLeft = `${depth * 14}px`;
            const toggle = Object.assign(document.createElement('button'), { className: 'prim-toggle', textContent: children.length ? (expanded.has(child) ? '▾' : '▸') : '' });
            toggle.addEventListener('click', event => {
                event.stopPropagation();
                if (!expanded.delete(child)) expanded.add(child);
                render();
            });
            name.addEventListener('click', () => onSelect(child));
            name.append(toggle, Object.assign(document.createElement('span'), { textContent: child.name || child.type, title: child.name }));
            const eye = Object.assign(document.createElement('button'), { className: 'prim-eye', innerHTML: child.visible && !inheritedOff ? EYE : EYE_OFF });
            eye.setAttribute('aria-pressed', String(child.visible));
            eye.addEventListener('click', () => {
                child.visible = !child.visible;
                render();
            });
            row.append(name, Object.assign(document.createElement('div'), { className: 'prim-type', textContent: child.userData.usdType ?? '', title: child.userData.usdType ?? '' }), eye);
            rows.push(row);
            if (expanded.has(child)) walk(child, depth + 1, inheritedOff || !child.visible);
        });
        walk(group, 0, false);
        $('stage-rows').replaceChildren(...rows);
        renderPath();
    };
    const renderPath = () => {
        $('prim-path').hidden = !selected;
        if (!selected) return;
        const chain = [];
        for (let prim = selected; prim && prim !== group; prim = prim.parent) chain.unshift(prim);
        const segments = chain.flatMap((prim, i) => [
            ...(i ? [Object.assign(document.createElement('span'), { textContent: '/' })] : []),
            Object.assign(document.createElement('button'), { textContent: prim.name || prim.type, title: prim.userData.usdType ?? '', onclick: () => onSelect(prim) })
        ]);
        $('prim-path').replaceChildren(...segments, Object.assign(document.createElement('span'), { className: 'prim-path-type', textContent: selected.userData.usdType ?? '' }));
    };
    const expand = (object, depth) => prims(object).forEach(child => {
        if (depth < 2 && prims(child).length) expanded.add(child);
        if (depth < 1) expand(child, depth + 1);
    });
    expand(group, 0);
    render();
    const show = open => {
        $('stage-panel').hidden = !open;
        $('stage-btn').classList.toggle('active', open);
    };
    if (prims(group).length) {
        $('stage-bar').hidden = false;
        $('stage-btn').addEventListener('click', () => show($('stage-panel').hidden));
        show(true);
    }
    return {
        select(prim) {
            selected = prim;
            if (prim) {
                for (let parent = prim.parent; parent && parent !== group; parent = parent.parent) expanded.add(parent);
                show(true);
            }
            render();
            document.querySelector('#stage-rows .prim-row.selected')?.scrollIntoView({ block: 'nearest' });
        }
    };
}
