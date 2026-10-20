(function () {
  "use strict";

  const TABLE_NAME = "zine_records";
  const BUCKET_NAME = "zine-media";
  const CLOUD_PREFIX = "zine_";
  const CACHE_OWNER_KEY = "__zine_cache_owner_v1";
  const config = window.ZINE_SUPABASE_CONFIG || {};
  const listeners = new Set();
  const authListeners = new Set();
  const writeQueues = new Map();
  let client = null;
  let session = null;
  let pendingWrites = 0;
  let syncInFlight = null;
  let resolveReady;

  const state = {
    configured: Boolean(
      typeof config.url === "string"
      && config.url.startsWith("https://")
      && typeof config.anonKey === "string"
      && config.anonKey.trim()
      && !config.anonKey.includes("YOUR_")
    ),
    status: "loading",
    message: "正在连接账号服务…",
    user: null,
    lastSyncAt: null,
    recovery: false,
  };

  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function snapshot() {
    return {
      ...state,
      user: state.user ? {
        id: state.user.id,
        email: state.user.email || "",
      } : null,
    };
  }

  function emit() {
    const detail = snapshot();
    listeners.forEach((listener) => {
      try {
        listener(detail);
      } catch (error) {
        console.error("A ZINE account listener failed.", error);
      }
    });
    window.dispatchEvent(new CustomEvent("zine:account-changed", { detail }));
  }

  function emitAuth(event) {
    const detail = { event, ...snapshot() };
    authListeners.forEach((listener) => {
      try {
        listener(detail);
      } catch (error) {
        console.error("A ZINE auth listener failed.", error);
      }
    });
    window.dispatchEvent(new CustomEvent("zine:auth-changed", { detail }));
  }

  function setStatus(status, message) {
    state.status = status;
    state.message = message || "";
    emit();
  }

  function cloudKeys() {
    const keys = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(CLOUD_PREFIX)) keys.push(key);
      }
    } catch (error) {
      console.error("Unable to inspect local ZINE records.", error);
    }
    return keys;
  }

  function readLocalRecord(key) {
    try {
      const serialized = localStorage.getItem(key);
      if (serialized === null) return null;
      return JSON.parse(serialized);
    } catch (error) {
      console.error(`Unable to read local record "${key}".`, error);
      return null;
    }
  }

  function localRecords() {
    return cloudKeys().map((key) => [key, readLocalRecord(key)])
      .filter(([, payload]) => payload !== null);
  }

  function writeLocalRecord(key, payload) {
    localStorage.setItem(key, JSON.stringify(payload));
  }

  function clearLocalCloudRecords() {
    cloudKeys().forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.error(`Unable to clear cached ZINE record "${key}".`, error);
      }
    });
  }

  function adoptLocalCache(userId) {
    const owner = localStorage.getItem(CACHE_OWNER_KEY);
    if (owner && owner !== userId) clearLocalCloudRecords();
    localStorage.setItem(CACHE_OWNER_KEY, userId);
  }

  async function uploadRecord(key, payload, userId) {
    if (!client || !userId) return;
    const { error } = await client
      .from(TABLE_NAME)
      .upsert(
        {
          user_id: userId,
          record_key: key,
          payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,record_key" }
      );
    if (error) throw error;
  }

  async function deleteCloudRecord(key, userId) {
    if (!client || !userId) return;
    const { error } = await client
      .from(TABLE_NAME)
      .delete()
      .eq("user_id", userId)
      .eq("record_key", key);
    if (error) throw error;
  }

  function enqueueWrite(key, operation) {
    const previous = writeQueues.get(key) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(operation)
      .then(() => {
        state.lastSyncAt = new Date().toISOString();
        pendingWrites = Math.max(0, pendingWrites - 1);
        if (pendingWrites === 0) setStatus("synced", "所有记录已同步");
      })
      .catch((error) => {
        pendingWrites = Math.max(0, pendingWrites - 1);
        console.error(`Unable to sync ZINE record "${key}".`, error);
        setStatus("error", "云端同步失败，本地记录已保留");
      });
    writeQueues.set(key, next);
    return next;
  }

  async function syncFromCloud() {
    if (!client || !session || !state.user) {
      return { changed: false, records: 0 };
    }
    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
      setStatus("syncing", "正在同步账号记录…");
      const { data, error } = await client
        .from(TABLE_NAME)
        .select("record_key,payload,updated_at")
        .eq("user_id", state.user.id)
        .order("record_key", { ascending: true });
      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      const cloudMap = new Map(rows.map((row) => [row.record_key, row.payload]));
      let changed = false;

      cloudMap.forEach((payload, key) => {
        if (!key.startsWith(CLOUD_PREFIX) || payload === null) return;
        try {
          const before = localStorage.getItem(key);
          const next = JSON.stringify(payload);
          if (before !== next) {
            localStorage.setItem(key, next);
            changed = true;
          }
        } catch (writeError) {
          console.error(`Unable to cache cloud record "${key}".`, writeError);
        }
      });

      const localOnly = localRecords().filter(([key]) => !cloudMap.has(key));
      if (localOnly.length) {
        const userId = state.user.id;
        const { error: uploadError } = await client
          .from(TABLE_NAME)
          .upsert(
            localOnly.map(([recordKey, payload]) => ({
              user_id: userId,
              record_key: recordKey,
              payload,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "user_id,record_key" }
          );
        if (uploadError) throw uploadError;
      }

      state.lastSyncAt = new Date().toISOString();
      setStatus("synced", rows.length ? "账号记录已同步" : "本地记录已保存到账号");
      window.dispatchEvent(new CustomEvent("zine:cloud-synced", {
        detail: { changed, records: rows.length + localOnly.length },
      }));
      return { changed, records: rows.length + localOnly.length };
    })()
      .catch((error) => {
        console.error("Unable to sync ZINE records from Supabase.", error);
        setStatus("error", "暂时无法连接云端，已继续使用本地记录");
        return { changed: false, records: 0, error };
      })
      .finally(() => {
        syncInFlight = null;
      });

    return syncInFlight;
  }

  async function handleSession(nextSession, event = "SESSION_UPDATED") {
    const previousUserId = state.user ? state.user.id : null;
    session = nextSession || null;
    state.user = session && session.user ? session.user : null;
    state.recovery = event === "PASSWORD_RECOVERY";
    if (state.user) {
      adoptLocalCache(state.user.id);
      await syncFromCloud();
    } else {
      if (previousUserId || event === "SIGNED_OUT") {
        clearLocalCloudRecords();
        localStorage.removeItem(CACHE_OWNER_KEY);
      }
      setStatus("signed_out", "登录后即可跨设备保存记录");
    }
    emitAuth(event);
  }

  async function initialize() {
    if (!state.configured) {
      setStatus("unconfigured", "请先填写 Supabase 的 publishable/anon key");
      resolveReady(snapshot());
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      setStatus("offline", "账号组件加载失败，已继续使用本地记录");
      resolveReady(snapshot());
      return;
    }

    try {
      client = window.supabase.createClient(config.url, config.anonKey.trim(), {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });

      client.auth.onAuthStateChange((event, nextSession) => {
        window.setTimeout(() => {
          handleSession(nextSession, event);
        }, 0);
      });

      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      await handleSession(data.session, "INITIAL_SESSION");
      resolveReady(snapshot());
    } catch (error) {
      console.error("Unable to initialize the ZINE account service.", error);
      setStatus("offline", "账号服务初始化失败，已继续使用本地记录");
      resolveReady(snapshot());
    }
  }

  function setRecord(key, payload) {
    try {
      writeLocalRecord(key, payload);
    } catch (error) {
      console.error(`Unable to save local record "${key}".`, error);
      return false;
    }

    if (client && state.user) {
      const userId = state.user.id;
      const serialized = JSON.stringify(payload);
      pendingWrites += 1;
      setStatus("syncing", "正在同步到账号…");
      enqueueWrite(key, () => uploadRecord(key, JSON.parse(serialized), userId));
    }
    return true;
  }

  function removeRecord(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Unable to remove local record "${key}".`, error);
      return false;
    }

    if (client && state.user) {
      const userId = state.user.id;
      pendingWrites += 1;
      setStatus("syncing", "正在同步删除操作…");
      enqueueWrite(key, () => deleteCloudRecord(key, userId));
    }
    return true;
  }

  async function uploadMedia(file, mediaId) {
    if (!client || !state.user) return null;
    const safeId = String(mediaId).replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${state.user.id}/${safeId}`;
    const { error } = await client.storage
      .from(BUCKET_NAME)
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
    if (error) {
      console.error("Unable to upload ZINE media.", error);
      setStatus("error", "视频已保存在本机，但未能上传到账号");
      return null;
    }
    return path;
  }

  async function downloadMedia(path) {
    if (!client || !state.user || !path) return null;
    const { data, error } = await client.storage.from(BUCKET_NAME).download(path);
    if (error) {
      console.error("Unable to download ZINE media.", error);
      return null;
    }
    return data;
  }

  async function signUp(email, password) {
    if (!client) throw new Error("账号服务尚未配置。");
    return client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/account.html`,
      },
    });
  }

  async function signIn(email, password) {
    if (!client) throw new Error("账号服务尚未配置。");
    const result = await client.auth.signInWithPassword({ email, password });
    if (!result.error) await handleSession(result.data.session, "SIGNED_IN");
    return result;
  }

  async function signOut() {
    if (!client) return { error: null };
    const result = await client.auth.signOut();
    if (!result.error) await handleSession(null, "SIGNED_OUT");
    return result;
  }

  async function resetPassword(email) {
    if (!client) throw new Error("账号服务尚未配置。");
    return client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/account.html`,
    });
  }

  async function updatePassword(password) {
    if (!client) throw new Error("账号服务尚未配置。");
    const result = await client.auth.updateUser({ password });
    if (!result.error) {
      state.recovery = false;
      emit();
    }
    return result;
  }

  window.ZineCloud = {
    ready,
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    onAuthChange(listener) {
      authListeners.add(listener);
      return () => authListeners.delete(listener);
    },
    syncNow: syncFromCloud,
    setRecord,
    removeRecord,
    uploadMedia,
    downloadMedia,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
  };

  initialize();
}());
