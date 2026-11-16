/* Service worker do J-Coldus: guarda os arquivos do app no aparelho para abrir sem internet.
   Os dados (lançamentos, PIN) não passam por aqui: ficam no IndexedDB do navegador.
   Ao publicar uma versão nova do app, aumente VERSAO: o aparelho baixa tudo de novo e apaga a cópia antiga.
   A versão nova vale a partir da próxima vez que o app abrir. Nenhum pedido sai para outro servidor. */
const VERSAO = 'j-coldus-v3';
const ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './fonts/SpaceGrotesk.ttf',
  './fonts/JetBrainsMono-latin.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-32.png',
];

// baixa um arquivo com até 3 tentativas (rede do celular oscila); cache: 'reload' pula o cache HTTP: a cópia nova é a do servidor
async function baixar(u) {
  let erro;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(new Request(u, { cache: 'reload' })); if (r.ok) return r; erro = new Error(u + ': HTTP ' + r.status); } catch (e) { erro = e; }
    await new Promise((ok) => setTimeout(ok, 300 * (i + 1)));
  }
  throw erro;
}
self.addEventListener('install', (e) => {
  // tudo ou nada: se um arquivo faltar, esta versão não instala (a anterior continua valendo) e o navegador tenta de novo depois
  e.waitUntil((async () => {
    const resp = await Promise.all(ARQUIVOS.map(baixar));
    const c = await caches.open(VERSAO);
    await Promise.all(resp.map((r, i) => c.put(ARQUIVOS[i], r)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('j-coldus-') && k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return; // o app não pede nada de fora; se pedir, o navegador cuida
  const raiz = new URL('./', self.location.href).pathname;
  // abrir o app: a página da rede, se houver internet (e a cópia é atualizada); sem internet, a página guardada.
  // Proteção: se a página da rede não for o J-Coldus (outro site no mesmo endereço), este service worker se desliga e apaga a cópia.
  if (r.mode === 'navigate' && (u.pathname === raiz || u.pathname === raiz + 'index.html')) {
    e.respondWith(fetch(r).then(async (resp) => {
      if (!resp.ok) return resp;
      const txt = await resp.clone().text();
      if (!txt.includes('name="jcoldus-pwa"')) {
        await self.registration.unregister();
        await Promise.all((await caches.keys()).filter((k) => k.startsWith('j-coldus-')).map((k) => caches.delete(k)));
        return resp;
      }
      const c = await caches.open(VERSAO);
      await c.put('./index.html', resp.clone());
      return resp;
    }).catch(() => caches.open(VERSAO).then((c) => c.match('./index.html')).then((h) => h || Response.error())));
    return;
  }
  // demais arquivos: a cópia guardada; sem cópia, a rede (e guarda, se for do app)
  e.respondWith(caches.open(VERSAO).then((c) => c.match(r, { ignoreSearch: true }).then((h) => h || fetch(r).then((resp) => {
    if (resp.ok && resp.type === 'basic') c.put(r, resp.clone());
    return resp;
  }))));
});
