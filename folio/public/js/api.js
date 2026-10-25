// Thin fetch wrapper: JSON in and out, CSRF header on every unsafe request, errors as exceptions.
let csrf = '';
let onUnauth = () => {};

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
    this.fields = data.fields || null;
  }
}

export const setCsrf = (token) => {
  csrf = token || '';
};
export const setUnauthHandler = (fn) => {
  onUnauth = fn;
};

async function request(method, url, body, { raw = false } = {}) {
  const headers = {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  if (raw) return res;
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : {};
  if (!res.ok) {
    if (res.status === 401 && data.code === 'unauthenticated') onUnauth();
    throw new ApiError(res.status, data.error || `Request failed (${res.status}).`, data);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, form) => request('POST', url, form),
};
