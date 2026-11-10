(() => {
  const host = window.location.hostname;
  const isLocalDevelopment = host === 'localhost' || host === '127.0.0.1';

  // Netlify serves /api through the proxy rule generated into dist/_redirects.
  // Local development continues to call the FastAPI server on port 8000.
  window.BUNKBUDGET_API_BASE_URL = isLocalDevelopment ? 'http://localhost:8000' : '';
})();
