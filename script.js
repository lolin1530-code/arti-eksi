let projectUrl = "";
let apiKey = "";
let playerToken = "";
let playerNumber = 0;
let roomCode = "";
let pollTimer = null;
let lastStatus = "";
let notes = [];
let numberMarks = {};
let gameState = null;
let ownSecret = "";

let startMessageTimer = null;
let startMessageShown = false;

let turnAudioContext = null;
let previousTurnKey = "";

let playerProfile = null;
let playerAchievements = new Set();

const achievementCatalog = [
  { key: "first_blood_1", category: "firstblood", title: "İlk Kan", description: "1 galibiyete ulaş.", threshold: 1 },
  { key: "first_blood_5", category: "firstblood", title: "Bela", description: "5 galibiyete ulaş.", threshold: 5 },
  { key: "first_blood_10", category: "firstblood", title: "BEN10", description: "10 galibiyete ulaş.", threshold: 10 },
  { key: "first_blood_37", category: "firstblood", title: "Yuh Ayı!", description: "37 galibiyete ulaş.", threshold: 37 },
  { key: "first_blood_62", category: "firstblood", title: "Dersim", description: "62 galibiyete ulaş.", threshold: 62 },
  { key: "first_blood_100", category: "firstblood", title: "Selam Sana İmparator", description: "100 galibiyete ulaş.", threshold: 100 },
  { key: "brat_one_guess", category: "brat", title: "BRAT", description: "Tek tahminde maçı kazan." },
  { key: "brat_hizli_kosan_atin", category: "brat", title: "Hızlı Koşan Atın...", description: "Kendi tahminlerinden birinde -4 alıp maçı kaybet." },
  { key: "brat_got_tutustu", category: "brat", title: "Göt Tutuştu", description: "Karşı taraf -4 almışken maçı kazan." },
  { key: "hidden_tarikat_cokuyor", category: "brat", title: "Tarikat Çöküyor", description: "Rakibin gizli sayısı 8041 iken maçı kazan.", hidden: true },
  { key: "hidden_kult_lideri", category: "brat", title: "Kült Lideri", description: "Gizli sayın 8041 iken maçı kazan.", hidden: true },
  { key: "streak_5", category: "streak", title: "Sıradaki Gelsin", description: "5 galibiyetlik yenilmezlik serisine ulaş.", threshold: 5 }
];

const achievementGroups = [
  { key: "w", categories: ["firstblood", "streak"], listId: "wAchievements", countId: "wAchievementCount", total: 7 },
  { key: "slay", categories: ["brat"], listId: "slayAchievements", countId: "slayAchievementCount", total: 5 }
];

let friendData = { friends: [], incoming: [], outgoing: [] };
let boundProfileRoomKey = "";
let profileBindingPromise = null;
let currentOpponentName = "Karşı taraf";
let opponentProfileRefreshAt = 0;
let lastFeedbackStatus = "";
let lastFeedbackRoom = "";

const $ = id => document.getElementById(id);

/* =========================
   PROFİL + KURTARMA + ARKADAŞ SİSTEMİ
========================= */

function createProfileId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  if (!window.crypto || !window.crypto.getRandomValues) return null;

  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createSecureHex(byteCount = 32) {
  if (!window.crypto || !window.crypto.getRandomValues) return null;
  const bytes = new Uint8Array(byteCount);
  window.crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function saveProfile() {
  localStorage.setItem("arti_profile", JSON.stringify(playerProfile));
  updateProfileEntry();
  if (typeof renderMatchProfiles === "function") renderMatchProfiles();
}

function loadProfile() {
  try {
    playerProfile = JSON.parse(localStorage.getItem("arti_profile")) || null;
  } catch {
    playerProfile = null;
  }

  if (playerProfile) {
    if (!isUuid(playerProfile.id)) playerProfile.id = createProfileId();
    if (!playerProfile.token) playerProfile.token = createSecureHex(32);
    if (!playerProfile.recoveryCode) playerProfile.recoveryCode = createSecureHex(16);
    if (!Array.isArray(playerProfile.processedMatches)) playerProfile.processedMatches = [];
    if (typeof playerProfile.synced !== "boolean") playerProfile.synced = false;
    if (typeof playerProfile.recoverySaved !== "boolean") playerProfile.recoverySaved = false;
    saveProfile();
  }

  updateProfileEntry();
}

function updateProfileEntry() {
  const button = $("openProfileBtn");
  const text = $("profileEntryText");
  if (!button || !text) return;

  if (playerProfile) {
    text.textContent = "Hoş geldin, " + playerProfile.username + "!";
    button.textContent = "Profilimi Görüntüle";
  } else {
    text.textContent = "Henüz bir profil oluşturmadın.";
    button.textContent = "+ Profil Oluştur";
  }
}

function openProfile() {
  $("profileModal").classList.remove("hidden");
  if (playerProfile) {
    showProfileView();
    if (projectUrl && apiKey) {
      syncProfileIfNeeded().then(() => loadFriendData()).catch(error => {
        $("friendStatus").textContent = error.message;
      });
    } else {
      $("friendStatus").textContent = "Arkadaşlık özellikleri için önce Supabase bağlantısını kur.";
    }
  } else {
    showProfileCreate();
  }
}

function closeProfile() {
  $("profileModal").classList.add("hidden");
  $("profileFormStatus").textContent = "";
}

function showProfileCreate() {
  $("profileCreateArea").classList.remove("hidden");
  $("profileRecoveryArea").classList.add("hidden");
  $("profileViewArea").classList.add("hidden");
  $("profileUsername").value = playerProfile ? playerProfile.username : "";
  $("profileFormStatus").textContent = "";
  $("saveProfileBtn").textContent = playerProfile ? "Değişiklikleri Kaydet" : "Profili Oluştur";
  $("showRecoveryBtn").classList.toggle("hidden", !!playerProfile);
}

function showRecoveryArea() {
  $("profileCreateArea").classList.add("hidden");
  $("profileRecoveryArea").classList.remove("hidden");
  $("profileViewArea").classList.add("hidden");
  $("recoveryStatus").textContent = "";
}

function showProfileView() {
  $("profileCreateArea").classList.add("hidden");
  $("profileRecoveryArea").classList.add("hidden");
  $("profileViewArea").classList.remove("hidden");
  renderProfile();
  refreshAchievements();
}

async function createOrUpdateProfile() {
  const username = $("profileUsername").value.trim();

  if (username.length < 2 || username.length > 20) {
    $("profileFormStatus").textContent = "Kullanıcı adı 2-20 karakter arasında olmalı.";
    return;
  }
  if (!projectUrl || !apiKey) {
    $("profileFormStatus").textContent = "Önce Supabase bağlantısını kurmalısın.";
    return;
  }

  $("saveProfileBtn").disabled = true;
  $("profileFormStatus").textContent = "Profil kaydediliyor...";

  try {
    if (!playerProfile) {
      const id = createProfileId();
      const token = createSecureHex(32);
      const recoveryCode = createSecureHex(16);

      if (!id || !token || !recoveryCode) {
        throw new Error("Bu tarayıcı güvenli kod üretimini desteklemiyor. Güncel bir tarayıcı kullan.");
      }

      const result = await rpc("create_player_profile", {
        p_id: id,
        p_username: username,
        p_token: token,
        p_wins: 0,
        p_losses: 0
      });

      if (result && result.success === false) {
        throw new Error(result.message || "Profil oluşturulamadı.");
      }

      playerProfile = {
        id,
        token,
        recoveryCode,
        username,
        wins: 0,
        losses: 0,
        streak: 0,
        createdAt: Date.now(),
        processedMatches: [],
        synced: true,
        recoverySaved: false
      };
      saveProfile();

      await saveRecoveryCode();
      await refreshRemoteProfile();
      showProfileView();
    } else {
      const result = await rpc("update_player_username", {
        p_id: playerProfile.id,
        p_token: playerProfile.token,
        p_username: username
      });

      if (result && result.success === false) {
        throw new Error(result.message || "Kullanıcı adı değiştirilemedi.");
      }

     if (!playerProfile.recoveryCode) {
  playerProfile.recoveryCode = createSecureHex(16);
  playerProfile.recoverySaved = false;
  saveProfile();
  await saveRecoveryCode();
}

playerProfile.username = username;
saveProfile();
await refreshRemoteProfile();
showProfileView();
    }
  } catch (error) {
    $("profileFormStatus").textContent = error.message;
  } finally {
    $("saveProfileBtn").disabled = false;
  }
}

async function saveRecoveryCode() {
  if (!playerProfile || !playerProfile.recoveryCode || !projectUrl || !apiKey) return;

  const result = await rpc("set_player_recovery_code", {
    p_id: playerProfile.id,
    p_token: playerProfile.token,
    p_recovery_code: playerProfile.recoveryCode
  });

  if (result && result.success === false) {
    throw new Error(result.message || "Kurtarma kodu kaydedilemedi.");
  }

  playerProfile.recoverySaved = true;
  saveProfile();
}

async function recoverProfile() {
  const username = $("recoveryUsername").value.trim();
  const recoveryCode = $("recoveryCodeInput").value.trim().toUpperCase();

  if (!username || !recoveryCode) {
    $("recoveryStatus").textContent = "Kullanıcı adı ve kurtarma kodunu gir.";
    return;
  }
  if (!projectUrl || !apiKey) {
    $("recoveryStatus").textContent = "Önce Supabase bağlantısını kurmalısın.";
    return;
  }

  $("recoverProfileBtn").disabled = true;
  $("recoveryStatus").textContent = "Profil aranıyor...";

  try {
    const result = await rpc("recover_player_profile", {
      p_username: username,
      p_recovery_code: recoveryCode
    });

    if (!result || !result.success) {
      throw new Error((result && result.message) || "Profil kurtarılamadı.");
    }

    playerProfile = {
      id: result.id,
      username: result.username,
      wins: Number(result.wins) || 0,
      losses: Number(result.losses) || 0,
      streak: Number(result.streak) || 0,
      token: result.token,
      recoveryCode,
      createdAt: Date.now(),
      processedMatches: [],
      synced: true,
      recoverySaved: true
    };

    saveProfile();
    await loadFriendData();
    showProfileView();
    $("friendStatus").textContent = "Profilin başarıyla geri yüklendi.";
  } catch (error) {
    $("recoveryStatus").textContent = error.message;
  } finally {
    $("recoverProfileBtn").disabled = false;
  }
}

async function syncProfileIfNeeded() {
  if (!playerProfile || !projectUrl || !apiKey) return;

  if (!playerProfile.id || !playerProfile.token || !playerProfile.recoveryCode) {
    throw new Error("Profil güvenlik bilgileri eksik. Kurtarma kodunla profilini geri yüklemeyi dene.");
  }

  if (!playerProfile.synced) {
    const result = await rpc("create_player_profile", {
      p_id: playerProfile.id,
      p_username: playerProfile.username,
      p_token: playerProfile.token,
      p_wins: Number(playerProfile.wins) || 0,
      p_losses: Number(playerProfile.losses) || 0
    });

    if (result && result.success === false) {
      throw new Error(result.message || "Profil sunucuya aktarılamadı.");
    }
    playerProfile.synced = true;
    saveProfile();
  }

  if (!playerProfile.recoverySaved) {
    await saveRecoveryCode();
  }

  await refreshRemoteProfile();
  // Profil ilk kez eşitlendikten sonra başarımları da mutlaka sunucudan çek.
  await refreshAchievements();
}

async function refreshRemoteProfile() {
  if (!playerProfile || !playerProfile.synced) return;

  const result = await rpc("get_player_profile", { p_id: playerProfile.id });
  if (result) {
    const profile = Array.isArray(result) ? result[0] : result;
    if (profile) {
      playerProfile.username = profile.username || playerProfile.username;
      playerProfile.wins = Number(profile.wins) || 0;
      playerProfile.losses = Number(profile.losses) || 0;
      playerProfile.streak = Number(profile.streak) || 0;
      saveProfile();
      renderMatchProfiles();
      if (!$("profileModal").classList.contains("hidden")) renderProfile();
    }
  }
}

function renderProfile() {
  if (!playerProfile) return;

  const wins = Number(playerProfile.wins) || 0;
  const losses = Number(playerProfile.losses) || 0;
  const total = wins + losses;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  $("profileDisplayName").textContent = playerProfile.username;
  $("profileAvatarLetter").textContent = playerProfile.username.charAt(0).toLocaleUpperCase("tr-TR");
  $("profileWins").textContent = wins;
  $("profileLosses").textContent = losses;
  if ($("profileStreak")) $("profileStreak").textContent = Number(playerProfile.streak) || 0;
  $("profileWinRate").textContent = "%" + winRate.toFixed(1).replace(".", ",");
  $("profileWinRateBar").style.width = winRate + "%";
  $("recoveryCodeDisplay").textContent = playerProfile.recoveryCode || "Kurtarma kodu bulunamadı";
  $("recoveryCodeStatus").textContent = playerProfile.recoverySaved
    ? "Kurtarma kodun sunucuya kaydedildi. Güvenli bir yere kopyala."
    : "Kurtarma kodunun sunucuya kaydedilmesi bekleniyor.";
  renderAchievements();
}

async function copyRecoveryCode() {
  if (!playerProfile || !playerProfile.recoveryCode) return;
  try {
    await navigator.clipboard.writeText(playerProfile.recoveryCode);
    $("recoveryCodeStatus").textContent = "Kurtarma kodu kopyalandı.";
  } catch {
    $("recoveryCodeStatus").textContent = "Kodu seçip elle kopyalayabilirsin.";
  }
}

/* Maç sonucunu sunucuya bir kez kaydeder; iki oyuncu için ayrı profil kaydı tutulur. */
async function recordProfileResult(state) {
  if (!playerProfile || !playerProfile.synced || !state || state.status !== "finished") return;

  const history = Array.isArray(state.history) ? state.history : [];
  const matchKey = [state.room_code || roomCode, state.winner, JSON.stringify(history)].join("|");

  playerProfile.processedMatches = Array.isArray(playerProfile.processedMatches)
    ? playerProfile.processedMatches : [];

  if (playerProfile.processedMatches.includes(matchKey)) return;

  // Yerel işaret, aynı maç için paralel yoklamaların çift kayıt göndermesini önler.
  playerProfile.processedMatches.push(matchKey);
  saveProfile();

  const won = state.winner === null || state.winner === undefined
    ? null : Number(state.winner) === Number(playerNumber);

  try {
    const result = await rpc("record_profile_result", {
      p_id: playerProfile.id,
      p_token: playerProfile.token,
      p_match_key: matchKey,
      p_won: won
    });

    if (result && result.success === false) {
      throw new Error(result.message || "Maç sonucu kaydedilemedi.");
    }
  } catch (error) {
    playerProfile.processedMatches = playerProfile.processedMatches.filter(key => key !== matchKey);
    saveProfile();
    console.error("Profil maç sonucu kaydedilemedi:", error);
    return;
  }

  // Sonuç kaydı başarılıysa, başarım hatası sonucu tekrar kaydettirmesin.
  try {
    const achievementResult = await rpc("unlock_match_achievements", {
      p_player_token: playerToken,
      p_profile_id: playerProfile.id,
      p_profile_token: playerProfile.token,
      p_match_key: matchKey
    });
    await refreshRemoteProfile();
    await refreshAchievements(achievementResult && achievementResult.unlocked ? achievementResult.unlocked : []);
  } catch (error) {
    console.error("Maç başarımları kaydedilemedi:", error);
    await refreshRemoteProfile().catch(profileError => {
      console.error("Profil güncellenemedi:", profileError);
    });
  }
}

async function refreshAchievements(newKeys = []) {
  if (!playerProfile || !playerProfile.synced || !projectUrl || !apiKey) return;
  try {
    const result = await rpc("get_player_achievements", { p_id: playerProfile.id });
    const rows = Array.isArray(result) ? result : (result ? [result] : []);
    playerAchievements = new Set(rows.map(item => item.achievement_key).filter(Boolean));
    renderAchievements();

    const newlyUnlocked = Array.isArray(newKeys) ? newKeys : [];
    if (newlyUnlocked.length) {
      const names = achievementCatalog
        .filter(item => newlyUnlocked.includes(item.key))
        .map(item => item.title);
      if (names.length) {
        $("achievementStatus").textContent = "Yeni başarım" + (names.length > 1 ? "lar" : "") + " açıldı: " + names.join(", ");
        $("achievementStatus").classList.add("achievement-unlock-message");
      }
    }
  } catch (error) {
    const status = $("achievementStatus");
    if (status) status.textContent = "Başarımlar yüklenemedi: " + error.message;
  }
}

function renderAchievements() {
  if (!$("wAchievements")) return;

  const wins = Number(playerProfile && playerProfile.wins) || 0;
  const streak = Number(playerProfile && playerProfile.streak) || 0;

  // W başarımları profilin sunucudaki toplam galibiyet/seri bilgisiyle de
  // doğrulanır. Böylece başarım RPC'si bir maçta başarısız olsa bile,
  // kazanılmış İlk Kan/Bela gibi kalıcı kilometre taşları kilitli görünmez.
  const winMilestones = achievementCatalog.filter(item =>
    item.category === "firstblood" && wins >= item.threshold
  );
  winMilestones.forEach(item => playerAchievements.add(item.key));
  if (streak >= 5) playerAchievements.add("streak_5");

  let unlockedTotal = 0;

  achievementGroups.forEach(group => {
    const container = $(group.listId);
    if (!container) return;
    container.innerHTML = "";

    const items = achievementCatalog.filter(item => group.categories.includes(item.category));
    const unlockedCount = items.filter(item => playerAchievements.has(item.key)).length;
    unlockedTotal += unlockedCount;

    const count = $(group.countId);
    if (count) count.textContent = unlockedCount + "/" + group.total;

    items.forEach(item => {
      const unlocked = playerAchievements.has(item.key);
      const hiddenLocked = item.hidden && !unlocked;
      const card = document.createElement("div");
      card.className = "achievement-item " + (unlocked ? "unlocked" : "locked") + (hiddenLocked ? " hidden-achievement" : "");

      const icon = document.createElement("div");
      icon.className = "achievement-icon";
      icon.textContent = unlocked ? "🔓" : "🔒";

      const body = document.createElement("div");
      body.className = "achievement-item-body";

      const title = document.createElement("strong");
      title.textContent = hiddenLocked ? "???" : item.title;

      const description = document.createElement("span");
      description.textContent = hiddenLocked ? "???" : item.description;

      const progress = document.createElement("small");
      if (hiddenLocked) {
        progress.textContent = "Gizli Başarım";
      } else if (unlocked) {
        progress.textContent = "AÇILDI";
      } else if (item.category === "firstblood") {
        progress.textContent = "Galibiyet: " + Math.min(wins, item.threshold) + "/" + item.threshold;
      } else if (item.key === "streak_5") {
        progress.textContent = "Seri: " + Math.min(streak, 5) + "/5";
      } else {
        progress.textContent = "Kilitli";
      }

      body.append(title, description, progress);
      card.append(icon, body);
      container.appendChild(card);
    });
  });

  const summary = $("achievementSummary");
  if (summary) summary.textContent = unlockedTotal + "/" + achievementCatalog.length + " açık";
}

/* Arkadaş arama ve istekler */
async function searchPlayer() {
  const username = $("friendSearchInput").value.trim();
  $("friendSearchResults").innerHTML = "";
  $("friendStatus").textContent = "";

  if (username.length < 2) {
    $("friendStatus").textContent = "Aramak için en az 2 karakter gir.";
    return;
  }
  if (!playerProfile || !playerProfile.synced) {
    $("friendStatus").textContent = "Önce profilini oluşturup sunucuya kaydet.";
    return;
  }

  $("friendSearchBtn").disabled = true;
  try {
    const results = await rpc("search_player", { p_username: username });
    const list = Array.isArray(results) ? results : (results ? [results] : []);
    const filtered = list.filter(item => item.id !== playerProfile.id);

    if (!filtered.length) {
      $("friendSearchResults").innerHTML = '<p class="friend-empty">Kullanıcı bulunamadı.</p>';
      return;
    }

    filtered.forEach(item => {
      const alreadyFriend = friendData.friends.some(friend =>
        getFriendId(friend) === item.id
      );
      const requestSent = friendData.outgoing.some(request =>
        getRequestTargetId(request) === item.id
      );
      const card = createFriendCard(
        item.username,
        `Galibiyet: ${Number(item.wins) || 0} · Mağlubiyet: ${Number(item.losses) || 0}`,
        alreadyFriend ? "Arkadaşsınız" : requestSent ? "İstek gönderildi" : "İstek Gönder",
        alreadyFriend || requestSent ? null : () => sendFriendRequest(item.id)
      );
      $("friendSearchResults").appendChild(card);
    });
  } catch (error) {
    $("friendStatus").textContent = error.message;
  } finally {
    $("friendSearchBtn").disabled = false;
  }
}

function getFriendId(item) {
  return item.profile_id || item.friend_id || item.friend_profile_id || item.id || item.user_id || "";
}
function getRequestTargetId(item) {
  return item.receiver_id || item.target_id || item.profile_id || item.receiver_profile_id || item.to_profile_id || "";
}

function getRequestId(item) {
  if (!item) return "";
  return item.request_id || item.friend_request_id || item.requestId ||
    item.friendRequestId || item.id || item.uuid ||
    (item.request && (item.request.id || item.request.request_id)) ||
    (item.friend_request && (item.friend_request.id || item.friend_request.request_id)) || "";
}

function getRequestUsername(item) {
  return item.username || item.requester_username || item.sender_username ||
    item.receiver_username || (item.requester && item.requester.username) ||
    (item.sender && item.sender.username) || "Oyuncu";
}

function createFriendCard(username, stats, actionLabel, action) {
  const card = document.createElement("div");
  card.className = "friend-card";

  const main = document.createElement("div");
  main.className = "friend-card-main";

  const name = document.createElement("div");
  name.className = "friend-card-name";
  name.textContent = username || "Oyuncu";

  const detail = document.createElement("div");
  detail.className = "friend-card-stats";
  detail.textContent = stats || "";

  main.append(name, detail);
  card.appendChild(main);

  if (actionLabel) {
    const actions = document.createElement("div");
    actions.className = "friend-card-actions";
    const button = document.createElement("button");
    button.textContent = actionLabel;
    button.className = "friend-add";
    if (action) button.addEventListener("click", action);
    else button.disabled = true;
    actions.appendChild(button);
    card.appendChild(actions);
  }
  return card;
}

async function sendFriendRequest(targetId) {
  try {
    const result = await rpc("send_friend_request", {
      p_id: playerProfile.id,
      p_token: playerProfile.token,
      p_target: targetId
    });
    if (result && result.success === false) throw new Error(result.message || "İstek gönderilemedi.");
    $("friendStatus").textContent = "Arkadaşlık isteği gönderildi.";
    await loadFriendData();
    await searchPlayer();
  } catch (error) {
    $("friendStatus").textContent = error.message;
  }
}

async function respondFriendRequest(requestId, accept) {
  try {
    if (!requestId) {
      throw new Error("İstek kimliği yüklenemedi. Arkadaşlık isteği verisini kontrol etmemiz gerekiyor.");
    }
    const result = await rpc("respond_friend_request", {
      p_id: playerProfile.id,
      p_token: playerProfile.token,
      p_request_id: requestId,
      p_accept: accept
    });
    if (result && result.success === false) throw new Error(result.message || "İstek güncellenemedi.");
    $("friendStatus").textContent = accept ? "Arkadaşlık isteği kabul edildi." : "İstek reddedildi.";
    await loadFriendData();
  } catch (error) {
    $("friendStatus").textContent = error.message;
  }
}

async function loadFriendData() {
  if (!playerProfile || !playerProfile.synced || !projectUrl || !apiKey) return;

  try {
    const result = await rpc("get_friend_data", {
      p_id: playerProfile.id,
      p_token: playerProfile.token
    });

    friendData = {
      friends: Array.isArray(result.friends) ? result.friends : [],
      incoming: Array.isArray(result.incoming) ? result.incoming : [],
      outgoing: Array.isArray(result.outgoing) ? result.outgoing : []
    };

    renderFriendData();
    await refreshFriendStats();
  } catch (error) {
    $("friendStatus").textContent = error.message;
  }
}

async function refreshFriendStats() {
  if (!playerProfile || !playerProfile.synced || !Array.isArray(friendData.friends)) return;
  const updates = friendData.friends.map(async item => {
    const id = getFriendId(item);
    if (!id) return;
    try {
      const result = await rpc("get_player_profile", { p_id: id });
      const profile = Array.isArray(result) ? result[0] : result;
      if (!profile) return;
      item.username = profile.username || item.username || item.friend_username;
      item.wins = Number(profile.wins) || 0;
      item.losses = Number(profile.losses) || 0;
      item.streak = Number(profile.streak) || 0;
    } catch (error) {
      console.warn("Arkadaş istatistiği yenilenemedi:", error);
    }
  });
  await Promise.all(updates);
  renderFriendData();
}

async function openRivalry(friend) {
  const friendId = getFriendId(friend);
  if (!friendId) {
    $("friendStatus").textContent = "Arkadaş profil kimliği alınamadı.";
    return;
  }

  const friendName = friend.username || friend.friend_username || "Arkadaşın";
  $("rivalryTitle").textContent = (playerProfile.username || "Sen") + " VS " + friendName;
  $("rivalryStatus").textContent = "İstatistikler yükleniyor...";
  $("rivalryMyWins").textContent = "—";
  $("rivalryTheirWins").textContent = "—";
  $("rivalryDraws").textContent = "—";
  $("rivalryTotal").textContent = "—";
  $("rivalryMyLabel").textContent = (playerProfile.username || "Sen") + " W";
  $("rivalryTheirLabel").textContent = friendName + " W";
  $("rivalryModal").classList.remove("hidden");

  try {
    const result = await rpc("get_rivalry_stats", {
      p_id: playerProfile.id,
      p_token: playerProfile.token,
      p_opponent_id: friendId
    });
    const stats = Array.isArray(result) ? result[0] : result;
    if (!stats || stats.success === false) {
      throw new Error((stats && stats.message) || "Rekabet istatistikleri alınamadı.");
    }
    const myWins = Number(stats.my_wins ?? stats.wins ?? 0) || 0;
    const theirWins = Number(stats.opponent_wins ?? stats.their_wins ?? stats.losses ?? 0) || 0;
    const draws = Number(stats.draws) || 0;
    const total = Number(stats.total ?? (myWins + theirWins + draws)) || 0;
    $("rivalryMyWins").textContent = myWins;
    $("rivalryTheirWins").textContent = theirWins;
    $("rivalryDraws").textContent = draws;
    $("rivalryTotal").textContent = total;
    $("rivalryStatus").textContent = total
      ? "Geçmişteki bütün ortak maçlarınız hesaba katılıyor."
      : "Henüz kayıtlı bir karşılaşmanız bulunmuyor.";
  } catch (error) {
    $("rivalryStatus").textContent = error.message;
  }
}

function closeRivalry() {
  $("rivalryModal").classList.add("hidden");
}

function renderFriendData() {
  const requests = $("friendRequestsList");
  const friends = $("friendsList");
  requests.innerHTML = "";
  friends.innerHTML = "";

  if (!friendData.incoming.length && !friendData.outgoing.length) {
    requests.innerHTML = '<p class="friend-empty">Bekleyen arkadaşlık isteği yok.</p>';
  } else {
    friendData.incoming.forEach(item => {
      const card = createFriendCard(
        getRequestUsername(item),
        "Sana arkadaşlık isteği gönderdi.",
        null,
        null
      );
      const actions = document.createElement("div");
      actions.className = "friend-card-actions";

      const accept = document.createElement("button");
      accept.className = "friend-accept";
      accept.textContent = "Kabul Et";
      accept.addEventListener("click", () => respondFriendRequest(getRequestId(item), true));

      const reject = document.createElement("button");
      reject.className = "friend-reject";
      reject.textContent = "Reddet";
      reject.addEventListener("click", () => respondFriendRequest(getRequestId(item), false));

      actions.append(accept, reject);
      card.appendChild(actions);
      requests.appendChild(card);
    });

    friendData.outgoing.forEach(item => {
      requests.appendChild(createFriendCard(
        getRequestUsername(item),
        "Gönderdiğin istek yanıt bekliyor.",
        "Bekliyor",
        null
      ));
    });
  }

  if (!friendData.friends.length) {
    friends.innerHTML = '<p class="friend-empty">Henüz arkadaşın yok.</p>';
  } else {
    friendData.friends.forEach(item => {
      const username = item.username || item.friend_username || "Oyuncu";
      const wins = Number(item.wins) || 0;
      const losses = Number(item.losses) || 0;
      const total = wins + losses;
      const rate = total ? ((wins / total) * 100).toFixed(1).replace(".", ",") : "0";
      const card = createFriendCard(
        username,
        `Galibiyet: ${wins} · Mağlubiyet: ${losses} · Başarı: %${rate}`,
        "Rekabeti Gör",
        () => openRivalry(item)
      );
      card.classList.add("friend-card-with-rivalry");
      friends.appendChild(card);
    });
  }
}

/* =========================
   MEVCUT OYUN SİSTEMİ
========================= */

function setColor(color) {
  $("color").value = color;
  document.querySelectorAll(".color-choice").forEach(button => {
    const selected = button.dataset.color === color;
    button.classList.toggle("active", selected);
    button.style.outline = selected ? "4px solid white" : "none";
    button.style.filter = selected ? "brightness(1.15)" : "brightness(0.8)";
  });
}

function setTurnMessage(message, color = "") {
  const turn = $("turn");
  const panel = $("turnPanel");
  if (!turn || !panel) return;
  if (!message) {
    panel.classList.add("hidden");
    turn.textContent = "";
    return;
  }
  turn.textContent = message;
  turn.style.color = color || "#f1f3f8";
  panel.classList.remove("hidden");
}

function enableTurnAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!turnAudioContext) turnAudioContext = new AudioContextClass();
  if (turnAudioContext.state === "suspended") turnAudioContext.resume().catch(() => {});
}

function playTone(frequency, startOffset, duration, peakGain, endFrequency = null) {
  if (!turnAudioContext) return;
  const oscillator = turnAudioContext.createOscillator();
  const gain = turnAudioContext.createGain();
  const start = turnAudioContext.currentTime + startOffset;
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) oscillator.frequency.linearRampToValueAtTime(endFrequency, start + duration * 0.45);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peakGain, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(turnAudioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}

function playTurnSound() {
  if (!turnAudioContext) return;
  const play = () => {
    if (!turnAudioContext) return;
    playTone(660, 0, 0.24, 0.19, 880);
  };
  if (turnAudioContext.state === "suspended") turnAudioContext.resume().then(play).catch(() => {});
  else play();
}

function vibrate(pattern) {
  try {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  } catch (error) {
    // Titreşim desteklenmiyorsa oyun normal şekilde devam eder.
  }
}

function playLastChanceFeedback() {
  if (turnAudioContext && turnAudioContext.state !== "closed") {
    if (turnAudioContext.state === "suspended") turnAudioContext.resume().then(() => {
      playTone(440, 0, 0.28, 0.17, 330);
      playTone(520, 0.22, 0.30, 0.19, 390);
    }).catch(() => {});
    else {
      playTone(440, 0, 0.28, 0.17, 330);
      playTone(520, 0.22, 0.30, 0.19, 390);
    }
  }
  vibrate([45, 35, 45]);
  animateGameResult("last-chance");
}

function playFinishedFeedback(won, draw = false) {
  if (turnAudioContext && turnAudioContext.state !== "closed") {
    const play = () => {
      if (draw) {
        playTone(520, 0, 0.34, 0.2, 520);
        playTone(520, 0.28, 0.34, 0.2, 520);
      } else if (won) {
        playTone(523, 0, 0.28, 0.22, 659);
        playTone(659, 0.20, 0.30, 0.23, 784);
        playTone(784, 0.42, 0.48, 0.24, 1047);
      } else {
        playTone(392, 0, 0.36, 0.20, 330);
        playTone(330, 0.28, 0.48, 0.21, 262);
      }
    };
    if (turnAudioContext.state === "suspended") turnAudioContext.resume().then(play).catch(() => {});
    else play();
  }

  if (draw) vibrate([55, 45, 55]);
  else if (won) vibrate([75, 55, 100]);
  else vibrate([140]);
  animateGameResult(draw ? "draw" : won ? "win" : "lose");
}

function animateGameResult(type) {
  const bar = $("gameResultBar");
  const text = $("gameResultText");
  if (!bar || !text) return;
  bar.classList.remove("result-last-chance", "result-win", "result-lose", "result-draw", "result-enter");
  void bar.offsetWidth;
  bar.classList.add("result-" + type, "result-enter");
}

function setCoinMessage(message) {
  const coin = $("coin");
  if (!coin) return;
  coin.textContent = message;
}

function renderMatchProfiles(state = gameState) {
  const p1 = state && state.player1_profile ? state.player1_profile : null;
  const p2 = state && state.player2_profile ? state.player2_profile : null;
  const ownSlot = Number(playerNumber) === 1 ? 1 : 2;
  const opponentName = state && (
    state.opponent_username || state.opponent_name ||
    (Number(playerNumber) === 1 ? state.player2_username : state.player1_username)
  );
  const local = playerProfile;
  currentOpponentName = (Number(playerNumber) === 1 ? p2 : p1)?.username ||
    (state && (state.opponent_username || state.opponent_name ||
      (Number(playerNumber) === 1 ? state.player2_username : state.player1_username))) ||
    (Number(playerNumber) === 1 ? "Oyuncu 2" : "Oyuncu 1");
  const opponentHeading = $("opponentGuessesHeading");
  if (opponentHeading) opponentHeading.textContent = currentOpponentName + " adlı oyuncunun tahminleri";

  function paint(slot, data, isOwn) {
    data = data || (isOwn ? local : null);
    const name = $("player" + slot + "ProfileName");
    const wins = $("player" + slot + "ProfileWins");
    const losses = $("player" + slot + "ProfileLosses");
    const streak = $("player" + slot + "ProfileStreak");
    if (!name) return;

    if (!data) {
      name.textContent = isOwn
        ? "Profil Bağlanmadı"
        : (opponentName || "Oyuncu " + slot);
      wins.textContent = losses.textContent = streak.textContent = "—";
      return;
    }

    name.textContent = data.username || (isOwn ? "Sen" : (opponentName || "Oyuncu " + slot));
    wins.textContent = Number(data.wins) || 0;
    losses.textContent = Number(data.losses) || 0;
    streak.textContent = Number(data.streak) || 0;
  }

  paint(1, p1 || (ownSlot === 1 ? local : null), ownSlot === 1);
  paint(2, p2 || (ownSlot === 2 ? local : null), ownSlot === 2);
}

async function bindCurrentProfileToRoom() {
  if (!playerToken || !playerProfile || !projectUrl || !apiKey) return;
  if (profileBindingPromise) return profileBindingPromise;
  const key = roomCode + ":" + playerProfile.id;
  if (boundProfileRoomKey === key) return;
  profileBindingPromise = (async () => {
    try {
      await syncProfileIfNeeded();
      const bindingResult = await rpc("bind_room_profile", {
        p_player_token: playerToken,
        p_profile_id: playerProfile.id,
        p_profile_token: playerProfile.token
      });
      if (bindingResult && bindingResult.success === false) {
        throw new Error(bindingResult.message || "Profil odaya bağlanamadı.");
      }
      boundProfileRoomKey = key;
      await refreshRemoteProfile();
    } catch (error) {
      console.warn("Profil odaya bağlanamadı:", error);
    } finally {
      profileBindingPromise = null;
    }
  })();
  return profileBindingPromise;
}

function clearStartMessage() {
  if (startMessageTimer) {
    clearTimeout(startMessageTimer);
    startMessageTimer = null;
  }
  startMessageShown = true;
}

function resetStartMessage() {
  if (startMessageTimer) {
    clearTimeout(startMessageTimer);
    startMessageTimer = null;
  }
  startMessageShown = false;
}

function saveSession() {
  localStorage.setItem("arti_session", JSON.stringify({
    projectUrl, apiKey, playerToken, playerNumber, roomCode
  }));
}

function saveNotes() {
  localStorage.setItem("arti_notes_" + playerToken, JSON.stringify(notes));
  localStorage.setItem("arti_marks_" + playerToken, JSON.stringify(numberMarks));
}

function loadNotes() {
  try {
    notes = JSON.parse(localStorage.getItem("arti_notes_" + playerToken)) || [];
    numberMarks = JSON.parse(localStorage.getItem("arti_marks_" + playerToken)) || {};
  } catch {
    notes = [];
    numberMarks = {};
  }
}

function saveOwnSecret() {
  localStorage.setItem("arti_secret_" + playerToken, ownSecret);
}

function loadOwnSecret() {
  ownSecret = localStorage.getItem("arti_secret_" + playerToken) || "";
  $("secret").value = ownSecret;
  $("secret").disabled = !!ownSecret;
  $("lockBtn").disabled = !!ownSecret;
  renderOwnSecret();
}

function clearRoundData() {
  resetStartMessage();
  ownSecret = "";
  notes = [];
  numberMarks = {};
  previousTurnKey = "";
  localStorage.removeItem("arti_secret_" + playerToken);
  saveNotes();
  $("secret").value = "";
  $("secret").disabled = false;
  $("lockBtn").disabled = false;
  $("secretStatus").textContent = "Yeni sayını belirle.";
  $("guess").value = "";
  $("feedback").textContent = "Yeni oyun başladı.";
  $("guessBtn").disabled = true;
  $("restartStatus").classList.add("hidden");
  $("gameResultBar").classList.add("hidden");
  $("restartBtn").classList.remove("hidden");
  setCoinMessage("");
  setTurnMessage("");
  renderOwnSecret();
  $("secretPanel").classList.remove("hidden");
  $("turnPanel").classList.remove("hidden");
  renderMatchProfiles();
  renderMyGuesses();
  renderNumberBoard();
}

function showGameScreen() {
  $("connectionScreen").classList.add("hidden");
  $("gameScreen").classList.remove("hidden");
  $("gameRoomInfo").textContent = "Oda kodu: " + roomCode;
}

function showConnectionScreen() {
  $("gameScreen").classList.add("hidden");
  $("connectionScreen").classList.remove("hidden");
}

async function rpc(name, params = {}) {
  const response = await fetch(projectUrl + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": apiKey,
      "Authorization": "Bearer " + apiKey
    },
    body: JSON.stringify(params)
  });

  let result;
  try { result = await response.json(); }
  catch { result = {}; }

  if (!response.ok) {
    throw new Error(result.message || result.details || result.hint || "Bağlantı hatası");
  }
  return result;
}

async function connect() {
  projectUrl = $("projectUrl").value.trim().replace(/\/$/, "");
  apiKey = $("apiKey").value.trim();

  if (!projectUrl || !apiKey) {
    $("connectionStatus").textContent = "URL ve anahtarı gir.";
    return;
  }

  localStorage.setItem("arti_url", projectUrl);
  localStorage.setItem("arti_key", apiKey);

  try {
    await rpc("get_game_state", { p_token: "00000000-0000-0000-0000-000000000000" });
  } catch (error) {
    if (error.message.includes("Failed to fetch")) {
      $("connectionStatus").textContent = "Sunucuya ulaşılamadı.";
      return;
    }
  }

  $("connectionStatus").textContent = "Supabase bağlantısı hazır.";

  if (playerProfile) {
    try {
      await syncProfileIfNeeded();
      $("connectionStatus").textContent = "Supabase bağlantısı hazır. Profilin eşitlendi.";
      if (!$("profileModal").classList.contains("hidden")) await loadFriendData();
    } catch (error) {
      $("connectionStatus").textContent = "Bağlantı hazır; profil eşitlenemedi: " + error.message;
    }
  }
}

async function createRoom() {
  try {
    const result = await rpc("create_room");
    playerToken = result.token || result.player_token;
    boundProfileRoomKey = "";
    playerNumber = 1;
    roomCode = result.room_code;
    if (!playerToken || !roomCode) throw new Error("Oda bilgileri alınamadı.");
    notes = [];
    numberMarks = {};
    ownSecret = "";
    lastStatus = "";
    previousTurnKey = "";
    gameState = null;
    resetStartMessage();
    saveSession();
    loadNotes();
    loadOwnSecret();
    showGameScreen();
    renderMatchProfiles(null);
    await bindCurrentProfileToRoom();
    startPolling();
    $("roomStatus").textContent = "Oda oluşturuldu: " + roomCode;
  } catch (error) {
    $("roomStatus").textContent = error.message;
  }
}

async function joinRoom() {
  try {
    const code = $("roomCode").value.trim().toUpperCase();
    if (!code) throw new Error("Oda kodunu gir.");
    const result = await rpc("join_room", { p_room_code: code });
    playerToken = result.token || result.player_token;
    boundProfileRoomKey = "";
    playerNumber = 2;
    roomCode = result.room_code || code;
    if (!playerToken) throw new Error("Oyuncu bilgisi alınamadı.");
    notes = [];
    numberMarks = {};
    ownSecret = "";
    lastStatus = "";
    previousTurnKey = "";
    gameState = null;
    resetStartMessage();
    saveSession();
    loadNotes();
    loadOwnSecret();
    showGameScreen();
    renderMatchProfiles(null);
    await bindCurrentProfileToRoom();
    startPolling();
    $("roomStatus").textContent = "Odaya katıldın.";
  } catch (error) {
    $("roomStatus").textContent = error.message;
  }
}

async function lockSecret() {
  const secret = $("secret").value.trim();
  if (!/^[1-9][0-9]{3}$/.test(secret) || new Set(secret).size !== 4) {
    $("secretStatus").textContent = "Dört farklı rakam gir. İlk rakam sıfır olamaz.";
    return;
  }
  try {
    await rpc("lock_secret", { p_token: playerToken, p_secret: secret });
    ownSecret = secret;
    saveOwnSecret();
    renderOwnSecret();
    $("secretStatus").textContent = "Sayın kilitlendi.";
    $("secret").disabled = true;
    $("lockBtn").disabled = true;
    if (secret === "8041") showEasterEgg();
    await refreshState();
  } catch (error) {
    $("secretStatus").textContent = error.message;
  }
}

function showEasterEgg() { $("easterEgg").classList.remove("hidden"); }
function closeEasterEgg() { $("easterEgg").classList.add("hidden"); }

async function submitGuess() {
  const guess = $("guess").value.trim();
  if (!/^[1-9][0-9]{3}$/.test(guess) || new Set(guess).size !== 4) {
    $("feedback").textContent = "Dört farklı rakam gir. İlk rakam sıfır olamaz.";
    return;
  }
  try {
    const result = await rpc("submit_guess", { p_token: playerToken, p_guess: guess });
    notes.push({ guess, plus: result.plus, minus: result.minus, marks: {} });
    saveNotes();
    $("guess").value = "";
    $("feedback").textContent = "+" + result.plus + " doğru konum · -" + result.minus + " yanlış konum";
    await refreshState();
  } catch (error) {
    $("feedback").textContent = error.message;
  }
}

function hideGameResult() {
  $("gameResultBar").classList.add("hidden");
  $("restartStatus").classList.add("hidden");
}

async function updateRestartStatus() {
  try {
    const result = await rpc("get_restart_status", { p_token: playerToken });
    if (result.me) {
      $("restartBtn").disabled = true;
      $("restartBtn").textContent = "İSTEK GÖNDERİLDİ";
      $("restartStatus").textContent = "Rakibin de tekrar oynamasını bekliyorsun.";
      $("restartStatus").classList.remove("hidden");
    } else {
      $("restartBtn").disabled = false;
      $("restartBtn").textContent = "TEKRAR OYNA";
      $("restartStatus").classList.add("hidden");
    }
  } catch (error) {
    $("restartStatus").textContent = error.message;
    $("restartStatus").classList.remove("hidden");
  }
}

async function requestRestart() {
  if (!gameState || gameState.status !== "finished") return;
  $("restartBtn").disabled = true;
  $("restartBtn").textContent = "BEKLE...";
  try {
    const result = await rpc("request_restart", { p_token: playerToken });
    if (result.restarted) {
      $("restartStatus").textContent = "Yeni oyun hazırlanıyor.";
      await refreshState();
    } else {
      $("restartBtn").textContent = "İSTEK GÖNDERİLDİ";
      $("restartStatus").textContent = "Rakibin de tekrar oynamasını bekliyorsun.";
      $("restartStatus").classList.remove("hidden");
    }
  } catch (error) {
    $("restartBtn").disabled = false;
    $("restartBtn").textContent = "TEKRAR OYNA";
    $("restartStatus").textContent = error.message;
    $("restartStatus").classList.remove("hidden");
  }
}

function showStartingPlayerMessage() {
  if (!gameState || gameState.status !== "playing") return;
  const history = Array.isArray(gameState.history) ? gameState.history : [];
  if (history.length > 0) {
    clearStartMessage();
    setTurnMessage("");
    return;
  }
  const currentTurn = Number(gameState.turn);
  if (currentTurn === playerNumber) setTurnMessage("Tahmine Başla", "#27c982");
  else setTurnMessage(currentOpponentName + " tahmine başlıyor", "#ff5364");
  startMessageShown = true;
}

async function refreshState() {
  if (!playerToken) return;
  try {
    const previousState = gameState;
    await bindCurrentProfileToRoom();
    const state = await rpc("get_game_state", { p_token: playerToken });
    roomCode = state.room_code || roomCode;
    gameState = state;

    if (state.player !== undefined && state.player !== null) {
      playerNumber = Number(state.player);
      saveSession();
    }

    // Oyuncu numarası kesinleştikten sonra profilleri doğru taraflara yerleştir.
    renderMatchProfiles(state);

    // Kendi profilimiz sunucu durumunda görünmüyorsa bağlamayı tekrar dene.
    // Böylece oda kurucusunun profili karşı oyuncuya da ulaşır.
    if (playerProfile && playerProfile.synced) {
      const ownRemoteProfile = Number(playerNumber) === 1
        ? state.player1_profile
        : state.player2_profile;
      if (!ownRemoteProfile || ownRemoteProfile.id !== playerProfile.id) {
        boundProfileRoomKey = "";
      }
    }

    await recordProfileResult(state);

    const previousWasActive = previousState && ["playing", "last_chance"].includes(previousState.status);
    const previousWasMyTurn = previousWasActive && Number(previousState.turn) === Number(playerNumber);
    const currentIsMyTurn = ["playing", "last_chance"].includes(state.status) && Number(state.turn) === Number(playerNumber);
    const gameJustStartedOnMyTurn = previousState && previousState.status === "waiting" && state.status === "playing" && currentIsMyTurn;
    const turnPassedToMe = previousWasActive && !previousWasMyTurn && currentIsMyTurn;
    const roomChanged = lastFeedbackRoom && lastFeedbackRoom !== (state.room_code || roomCode);
    if (roomChanged) lastFeedbackStatus = "";

    if (gameJustStartedOnMyTurn || turnPassedToMe) {
      playTurnSound();
      vibrate([25]);
    }
    if (previousState && previousState.status !== "last_chance" && state.status === "last_chance" && lastFeedbackStatus !== "last_chance") {
      playLastChanceFeedback();
      lastFeedbackStatus = "last_chance";
    }
    if (previousState && previousState.status !== "finished" && state.status === "finished" && lastFeedbackStatus !== "finished") {
      const isDraw = state.winner === null || state.winner === undefined;
      const isWin = !isDraw && Number(state.winner) === Number(playerNumber);
      playFinishedFeedback(isWin, isDraw);
      lastFeedbackStatus = "finished";
    }
    lastFeedbackRoom = state.room_code || roomCode;

    roomCode = state.room_code || roomCode;
    $("gameRoomInfo").textContent = "Oda kodu: " + roomCode;

    if (lastStatus === "finished" && state.status === "waiting") clearRoundData();

    const history = Array.isArray(state.history) ? state.history : [];

    if (state.status === "waiting") {
      $("secretPanel").classList.remove("hidden");
      $("turnPanel").classList.remove("hidden");
      resetStartMessage();
      $("guessBtn").disabled = true;
      hideGameResult();
      setCoinMessage("");

      const opponentProfile = Number(playerNumber) === 1
        ? state.player2_profile
        : state.player1_profile;
      const opponentJoined = Boolean(state.opponent_joined || opponentProfile);
      const opponentName = opponentProfile && opponentProfile.username
        ? opponentProfile.username
        : (state.opponent_username || state.opponent_name ||
          (Number(playerNumber) === 1 ? state.player2_username : state.player1_username));

      const namedOpponent = opponentName || "Rakip";
      if (!opponentJoined) setTurnMessage(namedOpponent + " Bekleniyor", "#ff5364");
      else if (!ownSecret && !state.opponent_locked) setTurnMessage("Senin ve " + namedOpponent + " adlı oyuncunun sayısını kilitlemesi bekleniyor", "#e8c34d");
      else if (ownSecret && !state.opponent_locked) setTurnMessage(namedOpponent + " adlı oyuncunun gizli sayısını kilitlemesi bekleniyor", "#e8c34d");
      else if (!ownSecret && state.opponent_locked) setTurnMessage("Gizli sayını kilitlemen bekleniyor", "#e8c34d");
      else setTurnMessage("İki oyuncu da sayısını kilitledi, oyun başlamak üzere", "#27c982");

      if (!ownSecret) {
        $("secret").disabled = false;
        $("lockBtn").disabled = false;
      }
    } else if (state.status === "playing") {
      $("secretPanel").classList.add("hidden");
      $("turnPanel").classList.add("hidden");
      const myTurn = Number(state.turn) === playerNumber;
      $("guessBtn").disabled = !myTurn || !ownSecret;
      hideGameResult();
      setCoinMessage("");

      if (history.length > 0) {
        clearStartMessage();
        setTurnMessage("");
      } else {
        if (!startMessageShown && !startMessageTimer) {
          setTurnMessage("İki Oyuncu da Sayısını Kilitledi, Oyun Başlamak Üzere", "#27c982");
          startMessageTimer = setTimeout(() => {
            startMessageTimer = null;
            showStartingPlayerMessage();
          }, 1500);
        } else if (startMessageShown) showStartingPlayerMessage();
      }
    } else if (state.status === "last_chance") {
      $("secretPanel").classList.add("hidden");
      $("turnPanel").classList.add("hidden");
      clearStartMessage();
      const myTurn = Number(state.turn) === playerNumber;
      $("guessBtn").disabled = !myTurn || !ownSecret;
      $("gameResultBar").classList.remove("hidden");
      $("gameResultText").className = "last-chance";
      $("restartStatus").classList.add("hidden");
      $("restartBtn").classList.add("hidden");
      setTurnMessage("");
      if (myTurn) {
        $("gameResultText").textContent = "⚔ SON ŞANSIN!";
        $("gameResultText").style.color = "#e8c34d";
      } else {
        $("gameResultText").textContent = "⚔ " + currentOpponentName.toLocaleUpperCase("tr-TR") + " SON ŞANSINI DENİYOR!";
        $("gameResultText").style.color = "#e8c34d";
      }
    } else if (state.status === "finished") {
      $("secretPanel").classList.add("hidden");
      $("turnPanel").classList.add("hidden");
      clearStartMessage();
      $("guessBtn").disabled = true;
      $("gameResultBar").classList.remove("hidden");
      $("gameResultText").className = "";
      $("restartBtn").classList.remove("hidden");
      setTurnMessage("");
      if (state.winner === null || state.winner === undefined) {
        $("gameResultText").textContent = "⚖ BERABERE!";
        $("gameResultText").style.color = "#e8c34d";
      } else if (Number(state.winner) === playerNumber) {
        $("gameResultText").textContent = "🏆 ZAFER! KAZANDIN!";
        $("gameResultText").style.color = "#27c982";
      } else {
        $("gameResultText").textContent = "OYUN BİTTİ · KAYBETTİN";
        $("gameResultText").style.color = "#ff5364";
      }
      await updateRestartStatus();
    } else {
      clearStartMessage();
      $("guessBtn").disabled = true;
      setCoinMessage("");
      setTurnMessage("");
    }

    lastStatus = state.status;
    if (Array.isArray(state.history)) renderOpponentGuesses(state.history);
    renderMyGuesses();
    renderTurnIndicator();
  } catch (error) {
    setTurnMessage(error.message, "#ff5364");
  }
}

function renderOwnSecret() {
  const display = $("mySecretDisplay");
  if (!display) return;
  display.textContent = ownSecret || "----";
  const wrapper = display.closest(".own-secret-inline");
  if (wrapper) wrapper.classList.toggle("hidden", !ownSecret);
}

function renderOpponentGuesses(history) {
  const list = $("opponentGuesses");
  list.innerHTML = "";
  const opponentHistory = history.filter(item => Number(item.player) !== playerNumber);
  if (opponentHistory.length === 0) {
    list.textContent = "Henüz tahmin yok.";
    return;
  }
  opponentHistory.forEach(item => {
    const row = document.createElement("div");
    row.className = "guess-row";
    for (const digit of item.guess) {
      const cell = document.createElement("div");
      cell.className = "guess-digit";
      cell.textContent = digit;
      row.appendChild(cell);
    }
    const result = document.createElement("div");
    result.textContent = "+" + item.plus + " / -" + item.minus;
    result.style.fontSize = "11px";
    result.style.color = "#aab6cc";
    list.appendChild(row);
    list.appendChild(result);
  });
}

function renderMyGuesses() {
  const list = $("myGuesses");
  list.innerHTML = "";
  if (notes.length === 0) {
    list.textContent = "Henüz tahmin yok.";
  } else {
    notes.forEach(item => {
      const row = document.createElement("div");
      row.className = "guess-row";
      for (let i = 0; i < 4; i++) {
        const cell = document.createElement("button");
        cell.className = "guess-digit";
        const mark = item.marks && item.marks[i];
        if (mark) cell.classList.add(mark);
        cell.textContent = item.guess[i];
        cell.onclick = () => {
          const color = $("color").value;
          item.marks = item.marks || {};
          if (item.marks[i] === color) delete item.marks[i];
          else item.marks[i] = color;
          saveNotes();
          renderMyGuesses();
          renderTurnIndicator();
        };
        row.appendChild(cell);
      }
      const result = document.createElement("div");
      result.textContent = "+" + item.plus + " / -" + item.minus;
      result.style.fontSize = "11px";
      result.style.color = "#aab6cc";
      list.appendChild(row);
      list.appendChild(result);
    });
  }
}

function renderTurnIndicator() {
  if (!gameState || !["playing", "last_chance"].includes(gameState.status)) {
    document.querySelectorAll(".guess-turn-message").forEach(el => el.remove());
    previousTurnKey = "";
    return;
  }

  const myTurn = Number(gameState.turn) === Number(playerNumber);
  const target = $(myTurn ? "myGuesses" : "opponentGuesses");
  if (!target) return;

  const messageText = myTurn ? "Tahminin Bekleniyor..." : currentOpponentName + " tahmin yapıyor...";
  const turnKey = gameState.status + ":" + gameState.turn;
  const existing = document.querySelector(".guess-turn-message");

  if (existing && existing.parentElement === target && existing.dataset.turnKey === turnKey) return;
  document.querySelectorAll(".guess-turn-message").forEach(el => el.remove());

  const message = document.createElement("div");
  message.className = "guess-turn-message " + (myTurn ? "my-turn" : "opponent-turn") + " turn-arrived";
  message.dataset.turnKey = turnKey;

  [...messageText].forEach((character, index) => {
    const letter = document.createElement("span");
    letter.textContent = character === " " ? "\u00A0" : character;
    letter.style.animationDelay = (index * 0.055) + "s";
    message.appendChild(letter);
  });
  target.appendChild(message);
  previousTurnKey = turnKey;
}

function renderNumberBoard() {
  const board = $("numberBoard");
  board.innerHTML = "";
  for (let i = 0; i <= 9; i++) {
    const button = document.createElement("button");
    button.className = "digit";
    button.textContent = i;
    if (numberMarks[i]) button.classList.add(numberMarks[i]);
    button.onclick = () => {
      const color = $("color").value;
      if (color === "yellow") {
        $("feedback").textContent = "Rakam tahtasında kırmızı veya yeşil kullanabilirsin.";
        return;
      }
      if (numberMarks[i] === color) delete numberMarks[i];
      else numberMarks[i] = color;
      saveNotes();
      renderNumberBoard();
    };
    board.appendChild(button);
  }
}

function resetNotes() {
  if (!confirm("Bütün kişisel işaretlemelerin silinsin mi?")) return;
  notes.forEach(item => item.marks = {});
  numberMarks = {};
  saveNotes();
  renderMyGuesses();
  renderTurnIndicator();
  renderNumberBoard();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  refreshState();
  pollTimer = setInterval(refreshState, 2500);
}

function loadSession() {
  projectUrl = localStorage.getItem("arti_url") || "";
  apiKey = localStorage.getItem("arti_key") || "";
  $("projectUrl").value = projectUrl;
  $("apiKey").value = apiKey;

  try {
    const saved = JSON.parse(localStorage.getItem("arti_session"));
    if (saved && saved.playerToken) {
      playerToken = saved.playerToken;
      playerNumber = saved.playerNumber;
      roomCode = saved.roomCode;
      projectUrl = saved.projectUrl;
      apiKey = saved.apiKey;
      $("projectUrl").value = projectUrl;
      $("apiKey").value = apiKey;
      loadNotes();
      loadOwnSecret();
      showGameScreen();
      startPolling();
    }
  } catch (error) {
    console.log(error);
  }

  if (playerProfile && projectUrl && apiKey) {
    syncProfileIfNeeded().catch(error => {
      $("connectionStatus").textContent = "Profil eşitleme hatası: " + error.message;
    });
  }
}

function initializeGame() {
  $("gameScreen").classList.add("hidden");
  $("connectionScreen").classList.remove("hidden");

  document.addEventListener("pointerdown", enableTurnAudio);
  document.addEventListener("keydown", enableTurnAudio);

  $("connectBtn").addEventListener("click", connect);
  $("createRoomBtn").addEventListener("click", createRoom);
  $("joinRoomBtn").addEventListener("click", joinRoom);
  $("lockBtn").addEventListener("click", lockSecret);
  $("guessBtn").addEventListener("click", submitGuess);
  $("resetNotesBtn").addEventListener("click", resetNotes);
  $("restartBtn").addEventListener("click", requestRestart);
  $("closeEasterEgg").addEventListener("click", closeEasterEgg);

  $("openProfileBtn").addEventListener("click", openProfile);
  $("closeProfileBtn").addEventListener("click", closeProfile);
  $("saveProfileBtn").addEventListener("click", createOrUpdateProfile);
  $("editProfileBtn").addEventListener("click", showProfileCreate);
  $("showRecoveryBtn").addEventListener("click", showRecoveryArea);
  $("backToProfileCreateBtn").addEventListener("click", showProfileCreate);
  $("recoverProfileBtn").addEventListener("click", recoverProfile);
  $("copyRecoveryCodeBtn").addEventListener("click", copyRecoveryCode);
  $("closeRivalryBtn").addEventListener("click", closeRivalry);
  $("closeRivalryFooterBtn").addEventListener("click", closeRivalry);
  $("rivalryModal").addEventListener("click", event => {
    if (event.target === $("rivalryModal")) closeRivalry();
  });

  $("profileUsername").addEventListener("keydown", event => {
    if (event.key === "Enter") createOrUpdateProfile();
  });
  $("recoveryCodeInput").addEventListener("keydown", event => {
    if (event.key === "Enter") recoverProfile();
  });
  $("recoveryUsername").addEventListener("keydown", event => {
    if (event.key === "Enter") recoverProfile();
  });

  $("friendSearchBtn").addEventListener("click", searchPlayer);
  $("friendSearchInput").addEventListener("keydown", event => {
    if (event.key === "Enter") searchPlayer();
  });

  document.querySelectorAll(".achievement-category-toggle").forEach(button => {
    button.addEventListener("click", () => {
      const list = $(button.dataset.achievementToggle);
      if (!list) return;
      const willOpen = list.classList.contains("hidden");
      list.classList.toggle("hidden", !willOpen);
      button.setAttribute("aria-expanded", String(willOpen));
    });
  });

  $("profileModal").addEventListener("click", event => {
    if (event.target === $("profileModal")) closeProfile();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("rivalryModal").classList.contains("hidden")) closeRivalry();
    else if (event.key === "Escape" && !$("profileModal").classList.contains("hidden")) closeProfile();
  });

  document.querySelectorAll(".color-choice").forEach(button => {
    button.addEventListener("click", () => setColor(button.dataset.color));
  });
  setColor("red");

  $("backBtn").addEventListener("click", () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    showConnectionScreen();
  });

  renderNumberBoard();
  renderMyGuesses();
  renderOwnSecret();
  loadProfile();
  loadSession();
}

initializeGame();
