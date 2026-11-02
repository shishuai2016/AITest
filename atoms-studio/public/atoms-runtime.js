(function () {
  'use strict';
  var config = window.__ATOMS_APP__ || {};
  var projectId = config.projectId || '';
  var memoryPrefix = 'atomsStore:' + (projectId || 'local') + ':';
  var apiBase = projectId ? '/api/apps/' + encodeURIComponent(projectId) + '/store' : '';

  function localGet(key, fallback) {
    try {
      var raw = window.localStorage.getItem(memoryPrefix + key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }
  function localSet(key, value) {
    try {
      window.localStorage.setItem(memoryPrefix + key, JSON.stringify(value));
    } catch (error) {
      /* storage can be unavailable in a sandboxed iframe */
    }
  }
  function localDel(key) {
    try {
      window.localStorage.removeItem(memoryPrefix + key);
    } catch (error) {
      /* ignore */
    }
  }
  function localList() {
    var out = {};
    try {
      for (var index = 0; index < window.localStorage.length; index += 1) {
        var key = window.localStorage.key(index);
        if (key && key.indexOf(memoryPrefix) === 0) {
          out[key.slice(memoryPrefix.length)] = JSON.parse(window.localStorage.getItem(key));
        }
      }
    } catch (error) {
      /* ignore */
    }
    return out;
  }

  async function request(path, options) {
    var response = await fetch(apiBase + path, Object.assign({ credentials: 'same-origin' }, options));
    if (response.status === 404) return { missing: true };
    if (!response.ok) {
      var detail = '';
      try {
        detail = (await response.json()).error || '';
      } catch (error) {
        /* ignore */
      }
      throw new Error(detail || 'store request failed: ' + response.status);
    }
    return response.json();
  }

  var store = {
    projectId: projectId,
    async get(key, fallback) {
      if (!apiBase) return localGet(key, fallback);
      try {
        var data = await request('/' + encodeURIComponent(key));
        if (data.missing) return localGet(key, fallback);
        return data.value;
      } catch (error) {
        return localGet(key, fallback);
      }
    },
    async set(key, value) {
      localSet(key, value);
      if (!apiBase) return true;
      try {
        await request('/' + encodeURIComponent(key), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: value }),
        });
        return true;
      } catch (error) {
        return false;
      }
    },
    async del(key) {
      localDel(key);
      if (!apiBase) return true;
      try {
        await request('/' + encodeURIComponent(key), { method: 'DELETE' });
        return true;
      } catch (error) {
        return false;
      }
    },
    async list() {
      if (!apiBase) return localList();
      try {
        var data = await request('');
        return data.items || {};
      } catch (error) {
        return localList();
      }
    },
  };

  window.atomsStore = store;
  window.atoms = Object.assign(window.atoms || {}, { store: store });
  try {
    window.dispatchEvent(new CustomEvent('atoms:ready', { detail: { projectId: projectId } }));
  } catch (error) {
    /* ignore */
  }
})();
