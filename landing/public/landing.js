const appOrigin = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:5173' : 'https://app.pxster.xyz';
for (const link of document.querySelectorAll('[data-auth]')) {
  link.href = `${appOrigin}/?auth=${link.dataset.auth}`;
}
