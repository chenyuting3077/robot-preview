import { SplatMesh } from '@sparkjsdev/spark';

const $ = id => document.getElementById(id);
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

export function buildStage(group) {
    document.querySelector('.stage-head span:last-child').innerHTML = EYE;
    const prims = object => object.children.filter(child => !(child instanceof SplatMesh));
    const expanded = new Set();
    const render = () => {
        const rows = [];
        const walk = (object, depth, inheritedOff) => prims(object).forEach(child => {
            const children = prims(child);
            const row = document.createElement('div');
            row.className = `prim-row${child.visible ? '' : ' off'}${inheritedOff ? ' inherited' : ''}`;
            const name = document.createElement('div');
            name.className = 'prim-name';
            name.style.paddingLeft = `${depth * 14}px`;
            const toggle = Object.assign(document.createElement('button'), { className: 'prim-toggle', textContent: children.length ? (expanded.has(child) ? '▾' : '▸') : '' });
            if (children.length) {
                name.style.cursor = 'pointer';
                name.addEventListener('click', () => {
                    if (!expanded.delete(child)) expanded.add(child);
                    render();
                });
            }
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
    };
    const expand = (object, depth) => prims(object).forEach(child => {
        if (depth < 2 && prims(child).length) expanded.add(child);
        if (depth < 1) expand(child, depth + 1);
    });
    expand(group, 0);
    render();
    if (!prims(group).length) return;
    $('stage-bar').hidden = false;
    const show = open => {
        $('stage-panel').hidden = !open;
        $('stage-btn').classList.toggle('active', open);
    };
    $('stage-btn').addEventListener('click', () => show($('stage-panel').hidden));
    show(true);
}
