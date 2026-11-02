const jsonHeaders = { 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...jsonHeaders, ...(options.headers || {}) },
  });
  let payload = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else {
    payload = await response.text().catch(() => '');
  }
  if (!response.ok) {
    const message = (payload && payload.error) || (typeof payload === 'string' && payload.slice(0, 200)) || `请求失败（${response.status}）`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export const api = {
  get: (path) => request(path),
  post: (path, body = {}) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body = {}) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body = {}) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (path) => request(path, { method: 'DELETE' }),
};

export function absoluteUrl(path) {
  return new URL(path, window.location.origin).href;
}
