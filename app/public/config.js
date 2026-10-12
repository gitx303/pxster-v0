window.PXSTER = Object.freeze({
  apiUrl: ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:8017" : "https://api.pxster.xyz"
});
