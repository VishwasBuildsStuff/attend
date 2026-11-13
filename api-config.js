(() => {
  const host = window.location.hostname;
  const isLocalDevelopment = host === 'localhost' || host === '127.0.0.1';

  // Production uses same-origin API routes; local development calls FastAPI on port 8000.
  window.BUNKBUDGET_API_BASE_URL = isLocalDevelopment ? 'http://localhost:8000' : '';
})();
