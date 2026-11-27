// Until the view is up, a throw shows in its error box instead of leaving a blank page (#24); import it first.
// Usage: import { startupDone } from './utils/startup-errors.js'; ... startupDone() once the view is up.

const show = event => {
    const error = 'reason' in event ? event.reason : event.error;
    // ResizeObserver's loop notice and other script errors carry no error object, and are no reason to stop.
    if (!error) return;
    let box = document.getElementById('load-error');
    // The URDF page makes its box only when it first shows an error.
    if (!box) {
        box = document.createElement('div');
        box.id = 'load-error';
        document.body.appendChild(box);
    }
    box.textContent = error.message ?? String(error);
    box.hidden = false;
    box.style.display = 'block';
    const loading = document.getElementById('loading-indicator');
    if (loading) loading.hidden = true;
    // Its message says all there is; logged, it would read as a bug of the viewer.
    if (error.name === 'WebGLUnavailable') event.preventDefault();
};

addEventListener('error', show);
addEventListener('unhandledrejection', show);

export function startupDone() {
    removeEventListener('error', show);
    removeEventListener('unhandledrejection', show);
}
