
const $ = id => document.getElementById(id);
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

const prims = object => object.children.filter(child => !child.userData.splat);
export const primRow = object => ({ object, prim: true, name: object.name || object.type, type: object.userData.usdType ?? '', children: () => prims(object).map(primRow) });
export const primRows = group => prims(group).map(primRow);

// A prim's name selects it (`onSelect`); a file row's name, which selects nothing, opens and closes it.
export function buildStage(rows, { files = false, removeLabel = '', onToggle = () => {}, onSelect = () => {} } = {}) {
    document.querySelector('.stage-head span:nth-child(3)').innerHTML = EYE;
    $('stage-panel').classList.toggle('files', files);
    const expanded = new Set();
    let selected = null;
    const flip = object => {
        if (!expanded.delete(object)) expanded.add(object);
        render();
    };
    const render = () => {
        const out = [];
        const walk = (list, depth, inheritedOff) => list.forEach(node => {
            const { object } = node;
            const children = node.children?.() ?? [];
            const row = document.createElement('div');
            row.className = `prim-row${object.visible ? '' : ' off'}${inheritedOff ? ' inherited' : ''}${node.error ? ' failed' : ''}${object === selected ? ' selected' : ''}`;
            const name = document.createElement('div');
            name.className = 'prim-name';
            name.style.paddingLeft = `${depth * 14}px`;
            const toggle = Object.assign(document.createElement('button'), { className: 'prim-toggle', textContent: children.length ? (expanded.has(object) ? '▾' : '▸') : '' });
            toggle.addEventListener('click', event => {
                event.stopPropagation();
                flip(object);
            });
            name.addEventListener('click', () => (node.prim ? onSelect(object) : children.length && flip(object)));
            name.append(toggle, Object.assign(document.createElement('span'), { textContent: node.name, title: node.name }));
            const type = Object.assign(document.createElement('div'), { className: 'prim-type' });
            if (node.error) Object.assign(type, { textContent: node.error, title: node.error });
            else if (typeof node.type === 'string') Object.assign(type, { textContent: node.type, title: node.type });
            else if (node.type) type.append(node.type);
            const eye = Object.assign(document.createElement('button'), { className: 'prim-eye', innerHTML: object.visible && !inheritedOff ? EYE : EYE_OFF });
            eye.setAttribute('aria-pressed', String(object.visible));
            eye.addEventListener('click', () => {
                object.visible = !object.visible;
                render();
                onToggle(object);
            });
            row.append(name, type, eye);
            if (files) {
                const remove = Object.assign(document.createElement('button'), { className: 'prim-remove', innerHTML: node.remove ? CROSS : '', title: node.remove ? removeLabel : '' });
                remove.disabled = !node.remove;
                if (node.remove) remove.addEventListener('click', node.remove);
                row.append(remove);
            }
            out.push(row);
            if (expanded.has(object)) walk(children, depth + 1, inheritedOff || !object.visible);
        });
        walk(rows(), 0, false);
        $('stage-rows').replaceChildren(...out);
        renderPath();
    };
    // The path runs from the USD stage's top prim, whatever file row it sits under.
    const renderPath = () => {
        $('prim-path').hidden = !selected;
        if (!selected) return;
        const chain = [];
        for (let prim = selected; prim && !prim.userData.stage; prim = prim.parent) chain.unshift(prim);
        const segments = chain.flatMap((prim, i) => [
            ...(i ? [Object.assign(document.createElement('span'), { textContent: '/' })] : []),
            Object.assign(document.createElement('button'), { textContent: prim.name || prim.type, title: prim.userData.usdType ?? '', onclick: () => onSelect(prim) })
        ]);
        $('prim-path').replaceChildren(...segments, Object.assign(document.createElement('span'), { className: 'prim-path-type', textContent: selected.userData.usdType ?? '' }));
    };
    const expand = (list, depth) => list.forEach(node => {
        const children = node.children?.() ?? [];
        if (depth < 2 && children.length) expanded.add(node.object);
        if (depth < 1) expand(children, depth + 1);
    });
    expand(rows(), files ? -1 : 0);
    render();
    const show = open => {
        $('stage-panel').hidden = !open;
        $('stage-btn').classList.toggle('active', open);
    };
    if (rows().length) {
        $('stage-bar').hidden = false;
        $('stage-btn').addEventListener('click', () => show($('stage-panel').hidden));
        show(true);
    }
    return {
        render,
        select(prim) {
            selected = prim;
            if (prim) {
                for (let parent = prim.parent; parent; parent = parent.parent) expanded.add(parent);
                show(true);
            }
            render();
            document.querySelector('#stage-rows .prim-row.selected')?.scrollIntoView({ block: 'nearest' });
        }
    };
}
