(() => {
  'use strict';

  const API_BASE_URL = window.BUNKBUDGET_API_BASE_URL || '';
  const API_BASE = `${API_BASE_URL}/api`;
  const TOKEN_KEY = 'bunkbudget:accessToken';
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const loginTab = document.getElementById('login-tab');
  const registerTab = document.getElementById('register-tab');

  function showForm(mode) {
    const registering = mode === 'register';
    loginForm.hidden = registering;
    registerForm.hidden = !registering;
    loginTab.classList.toggle('active', !registering);
    registerTab.classList.toggle('active', registering);
    loginTab.setAttribute('aria-selected', String(!registering));
    registerTab.setAttribute('aria-selected', String(registering));
    document.getElementById('form-title').textContent = registering ? 'Create your account' : 'Welcome back';
    document.getElementById('form-intro').textContent = registering
      ? 'Add your student details and set a password to get started.'
      : 'Sign in with your USN, registration number, or email.';
    document.querySelectorAll('.error-message').forEach((element) => {
      element.hidden = true;
      element.textContent = '';
    });
    document.getElementById(registering ? 'full_name' : 'login-identifier').focus();
  }

  function showError(element, message) {
    element.textContent = message;
    element.hidden = false;
  }

  async function postJson(path, payload) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let body = {};
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      let detail = typeof body.detail === 'string' ? body.detail : '';
      if (!detail && Array.isArray(body.detail)) {
        detail = body.detail.map((item) => item.msg).filter(Boolean).join(' ')
          .replaceAll('Value error, ', '');
      }
      const message = response.status === 401
        ? 'Invalid USN, registration number, email, or password.'
        : response.status === 409
          ? 'An account already exists with this USN, registration number, or email.'
          : response.status === 404
            ? 'The login API was not found. Deploy the FastAPI service on Render and point Netlify BUNKBUDGET_API_URL to its service URL.'
            : [502, 503, 504].includes(response.status)
              ? 'The login server is unavailable. Check that the FastAPI service is running on Render.'
              : detail || `The server could not complete the request (HTTP ${response.status}). Check the API deployment logs and try again.`;
      throw new Error(message);
    }
    return body;
  }

  function finishAuthentication(response) {
    if (typeof response.access_token !== 'string' || !response.access_token) {
      throw new Error('The server returned an invalid authentication response.');
    }
    localStorage.setItem(TOKEN_KEY, response.access_token);
    window.location.assign('dashboard.html');
  }

  async function loginUser(identifier, password) {
    const response = await postJson('/login', { identifier, password });
    finishAuthentication(response);
    return response;
  }

  async function registerUser(account) {
    const response = await postJson('/register', account);
    finishAuthentication(response);
    return response;
  }

  loginTab.addEventListener('click', () => showForm('login'));
  registerTab.addEventListener('click', () => showForm('register'));

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = document.getElementById('login-error');
    const button = document.getElementById('login-submit');
    error.hidden = true;
    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;
    if (!identifier || !password) {
      showError(error, 'Enter your USN, registration number, or email and password.');
      return;
    }

    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      await loginUser(identifier, password);
    } catch (err) {
      showError(error, err instanceof TypeError
        ? 'Cannot reach the login service. Check that the API deployment is online and its URL is configured.'
        : err.message || 'Login failed. Please try again.');
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = document.getElementById('register-error');
    const button = document.getElementById('register-submit');
    error.hidden = true;

    const fullName = document.getElementById('full_name').value.trim();
    const studentClass = document.getElementById('student-class').value.trim();
    const usn = document.getElementById('register-usn').value.trim().toUpperCase();
    const registrationNumber = document.getElementById('registration-number').value.trim().toUpperCase();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const phoneNumber = document.getElementById('phone-number').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmation = document.getElementById('password-confirmation').value;

    if (!fullName || !studentClass || !usn || !registrationNumber || !email || !phoneNumber || !password || !confirmation) {
      showError(error, 'Complete every field to create your account.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError(error, 'Enter a valid email address.');
      document.getElementById('register-email').focus();
      return;
    }
    if (!/^[a-z0-9]{10}$/i.test(usn)) {
      showError(error, 'Enter a valid 10-character alphanumeric USN.');
      document.getElementById('register-usn').focus();
      return;
    }
    const phoneDigits = phoneNumber.replace(/\D/g, '');
    if (!/^\+?[0-9() .-]+$/.test(phoneNumber) || phoneDigits.length < 10 || phoneDigits.length > 15) {
      showError(error, 'Enter a phone number with 10 to 15 digits.');
      document.getElementById('phone-number').focus();
      return;
    }
    if (password.length < 8 || new TextEncoder().encode(password).length > 72) {
      showError(error, 'Use a password of at least 8 characters and no more than 72 bytes.');
      return;
    }
    if (password !== confirmation) {
      showError(error, 'The passwords do not match.');
      return;
    }

    button.disabled = true;
    button.textContent = 'Creating account…';
    try {
      await registerUser({
        full_name: fullName,
        student_class: studentClass,
        usn,
        registration_number: registrationNumber,
        email,
        phone_number: phoneNumber,
        password,
        password_confirmation: confirmation
      });
    } catch (err) {
      showError(error, err instanceof TypeError
        ? 'Cannot reach the login service. Check that the API deployment is online and its URL is configured.'
        : err.message || 'Account creation failed. Please try again.');
    } finally {
      button.disabled = false;
      button.textContent = 'Create account';
    }
  });

  window.loginUser = loginUser;
  window.registerUser = registerUser;
})();
