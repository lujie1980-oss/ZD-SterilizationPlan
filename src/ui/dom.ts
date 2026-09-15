export function $(sel: string, el: ParentNode = document): HTMLElement {
  const n = (el as Document | Element).querySelector(sel);
  if (!n) throw new Error(`Missing element ${sel}`);
  return n as HTMLElement;
}

export function $opt(sel: string, el: ParentNode = document): HTMLElement | null {
  return (el as Document | Element).querySelector(sel) as HTMLElement | null;
}

export function $$(sel: string, el: ParentNode = document): HTMLElement[] {
  return Array.from((el as Document | Element).querySelectorAll(sel)) as HTMLElement[];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toast(msg: string, type: 'success' | 'error' | 'warn' | 'info' = 'success'): void {
  const c = $opt('#toastContainer');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  el.innerHTML = `<span>${icon}</span><span>${escapeHtml(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}
