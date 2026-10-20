const accountLoading = document.getElementById("accountLoading");
const signedOutView = document.getElementById("signedOutView");
const signedInView = document.getElementById("signedInView");
const recoveryView = document.getElementById("recoveryView");
const loginModeButton = document.getElementById("loginModeBtn");
const signupModeButton = document.getElementById("signupModeBtn");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authSubmitButton = document.getElementById("authSubmitBtn");
const forgotPasswordButton = document.getElementById("forgotPasswordBtn");
const authStatus = document.getElementById("authStatus");
const accountEmail = document.getElementById("accountEmail");
const cloudState = document.getElementById("cloudState");
const lastSyncTime = document.getElementById("lastSyncTime");
const syncNowButton = document.getElementById("syncNowBtn");
const logoutButton = document.getElementById("logoutBtn");
const accountStatus = document.getElementById("accountStatus");
const passwordForm = document.getElementById("passwordForm");
const newPassword = document.getElementById("newPassword");
const passwordStatus = document.getElementById("passwordStatus");

let authMode = "login";
let accountSnapshot = null;

const statusText = {
  loading: "正在连接…",
  syncing: "同步中",
  synced: "已同步",
  signed_out: "未登录",
  offline: "仅本地保存",
  error: "同步遇到问题",
  unconfigured: "尚未配置",
};

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === "signup";
  loginModeButton.classList.toggle("active", !signingUp);
  signupModeButton.classList.toggle("active", signingUp);
  loginModeButton.setAttribute("aria-selected", String(!signingUp));
  signupModeButton.setAttribute("aria-selected", String(signingUp));
  authSubmitButton.textContent = signingUp ? "创建账号" : "登录";
  authPassword.autocomplete = signingUp ? "new-password" : "current-password";
  forgotPasswordButton.hidden = signingUp;
  setStatus(authStatus, "");
}

function formatSyncTime(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function render(snapshot) {
  accountSnapshot = snapshot;
  accountLoading.hidden = true;

  const hasUser = Boolean(snapshot.user);
  signedOutView.hidden = hasUser || snapshot.recovery;
  signedInView.hidden = !hasUser;
  recoveryView.hidden = !snapshot.recovery;

  if (snapshot.recovery) {
    newPassword.focus();
    return;
  }

  if (!hasUser) {
    if (snapshot.status === "unconfigured") {
      setStatus(
        authStatus,
        "还需要在 supabase-config.js 中填写 Supabase 的 publishable/anon key。",
        true
      );
      authSubmitButton.disabled = true;
    } else if (snapshot.status === "offline") {
      setStatus(authStatus, snapshot.message, true);
      authSubmitButton.disabled = true;
    } else {
      authSubmitButton.disabled = false;
    }
    return;
  }

  accountEmail.textContent = snapshot.user.email || "已登录账号";
  cloudState.textContent = statusText[snapshot.status] || snapshot.message || "已连接";
  lastSyncTime.textContent = formatSyncTime(snapshot.lastSyncAt);
  syncNowButton.disabled = snapshot.status === "syncing";
}

function errorMessage(error) {
  const message = error && typeof error.message === "string" ? error.message : "操作失败，请稍后重试。";
  const translations = [
    [/invalid login credentials/i, "邮箱或密码不正确。"],
    [/email not confirmed/i, "请先打开验证邮件并确认邮箱。"],
    [/user already registered/i, "这个邮箱已经注册，请直接登录。"],
    [/password should be at least/i, "密码至少需要 6 个字符。"],
    [/invalid email/i, "请输入有效的邮箱地址。"],
    [/rate limit|too many/i, "操作次数过多，请稍后再试。"],
    [/network|fetch/i, "无法连接账号服务，请检查网络。"],
  ];
  const match = translations.find(([pattern]) => pattern.test(message));
  return match ? match[1] : message;
}

loginModeButton.addEventListener("click", () => setAuthMode("login"));
signupModeButton.addEventListener("click", () => setAuthMode("signup"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authSubmitButton.disabled = true;
  setStatus(authStatus, authMode === "signup" ? "正在创建账号…" : "正在登录…");

  try {
    if (authMode === "signup") {
      const { data, error } = await ZineCloud.signUp(email, password);
      if (error) throw error;
      if (data.session) {
        setStatus(authStatus, "账号已创建，正在同步记录…");
      } else {
        setStatus(authStatus, "验证邮件已发送，请打开邮件完成确认后再登录。");
        authPassword.value = "";
      }
    } else {
      const { error } = await ZineCloud.signIn(email, password);
      if (error) throw error;
      authPassword.value = "";
      setStatus(authStatus, "登录成功。");
    }
  } catch (error) {
    console.error("Unable to complete ZINE authentication.", error);
    setStatus(authStatus, errorMessage(error), true);
  } finally {
    authSubmitButton.disabled = Boolean(
      accountSnapshot
      && (accountSnapshot.status === "unconfigured" || accountSnapshot.status === "offline")
    );
  }
});

forgotPasswordButton.addEventListener("click", async () => {
  const email = authEmail.value.trim();
  if (!email) {
    setStatus(authStatus, "请先填写邮箱地址。", true);
    authEmail.focus();
    return;
  }

  forgotPasswordButton.disabled = true;
  setStatus(authStatus, "正在发送重设密码邮件…");
  try {
    const { error } = await ZineCloud.resetPassword(email);
    if (error) throw error;
    setStatus(authStatus, "重设密码邮件已发送，请检查邮箱。");
  } catch (error) {
    console.error("Unable to send the ZINE password reset email.", error);
    setStatus(authStatus, errorMessage(error), true);
  } finally {
    forgotPasswordButton.disabled = false;
  }
});

syncNowButton.addEventListener("click", async () => {
  syncNowButton.disabled = true;
  setStatus(accountStatus, "正在同步…");
  try {
    const result = await ZineCloud.syncNow();
    if (result.error) throw result.error;
    setStatus(accountStatus, result.records ? "账号记录已同步。" : "当前没有需要同步的记录。");
  } catch (error) {
    console.error("Unable to sync ZINE records.", error);
    setStatus(accountStatus, "同步失败，本地记录仍会保留。", true);
  } finally {
    syncNowButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  setStatus(accountStatus, "正在退出…");
  try {
    const { error } = await ZineCloud.signOut();
    if (error) throw error;
    authMode = "login";
    setAuthMode("login");
  } catch (error) {
    console.error("Unable to sign out of ZINE.", error);
    setStatus(accountStatus, errorMessage(error), true);
  } finally {
    logoutButton.disabled = false;
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = passwordForm.querySelector("button[type='submit']");
  button.disabled = true;
  setStatus(passwordStatus, "正在保存新密码…");
  try {
    const { error } = await ZineCloud.updatePassword(newPassword.value);
    if (error) throw error;
    newPassword.value = "";
    setStatus(passwordStatus, "新密码已保存。");
  } catch (error) {
    console.error("Unable to update the ZINE password.", error);
    setStatus(passwordStatus, errorMessage(error), true);
  } finally {
    button.disabled = false;
  }
});

(async function bootAccountPage() {
  try {
    const snapshot = await ZineCloud.ready;
    render(snapshot);
    ZineCloud.subscribe(render);
    ZineCloud.onAuthChange((auth) => {
      if (auth.event === "PASSWORD_RECOVERY") {
        signedOutView.hidden = true;
        signedInView.hidden = true;
        recoveryView.hidden = false;
        newPassword.focus();
      }
    });
  } catch (error) {
    console.error("Unable to open the ZINE account page.", error);
    accountLoading.hidden = true;
    signedOutView.hidden = false;
    authSubmitButton.disabled = true;
    setStatus(authStatus, "账号服务加载失败，请刷新页面重试。", true);
  }
}());
