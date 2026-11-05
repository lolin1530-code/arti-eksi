
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

const $ = (id) => document.getElementById(id);

function saveSession() {
  localStorage.setItem("arti_session", JSON.stringify({
    projectUrl,
    apiKey,
    playerToken,
    playerNumber,
    roomCode
  }));

  localStorage.setItem("arti_url", projectUrl);
  localStorage.setItem("arti_key", apiKey);
}

function saveNotes() {
  if (!playerToken) return;

  localStorage.setItem("arti_notes_" + playerToken, JSON.stringify(notes));
  localStorage.setItem("arti_marks_" + playerToken, JSON.stringify(numberMarks));
}

function loadNotes() {
  if (!playerToken) return;

  try {
    notes = JSON.parse(localStorage.getItem("arti_notes_" + playerToken) || "[]");
    numberMarks = JSON.parse(localStorage.getItem("arti_marks_" + playerToken) || "{}");
  } catch {
    notes = [];
    numberMarks = {};
  }

  ownSecret = localStorage.getItem("arti_secret_" + playerToken) || "";
}

function showMessage(id, message) {
  const element = $(id);
  if (element) element.textContent = message;
}

function showResultOverlay(message) {
  $("resultOverlayText").textContent = message;
  $("resultOverlay").classList.remove("hidden");
}

function hideResultOverlay() {
  $("resultOverlay").classList.add("hidden");
}

async function rpc(functionName, body = {}) {
  if (!projectUrl || !apiKey) {
    throw new Error("Önce Supabase bağlantısını yap.");
  }

  const response = await fetch(
    projectUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + functionName,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey
      },
      body: JSON.stringify(body)
    }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      result?.message ||
      result?.details ||
      "Supabase hatası: " + response.status
    );
  }

  return result;
}

async function connect() {
  const url = $("projectUrl").value.trim().replace(/\/$/, "");
  const key = $("apiKey").value.trim();

  if (!url || !key) {
    showMessage("connectionStatus", "Project URL ve Publishable Key gir.");
    return;
  }

  if (!url.startsWith("https://") || !url.includes(".supabase.co")) {
    showMessage("connectionStatus", "Project URL hatalı.");
    return;
  }

  projectUrl = url;
  apiKey = key;

  showMessage("connectionStatus", "Bağlantı kontrol ediliyor...");

  try {
    const response = await fetch(
      projectUrl + "/rest/v1/rpc/get_game_state",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": apiKey
        },
        body: JSON.stringify({
          p_token: "00000000-0000-0000-0000-000000000000"
        })
      }
    );

    const result = await response.json().catch(() => null);

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        result?.message ||
        result?.msg ||
        "API anahtarı reddedildi. Anahtar türünü kontrol et."
      );
    }

    if (response.status === 404) {
      throw new Error("get_game_state fonksiyonu bulunamadı.");
    }

    // Geçersiz test token'ı nedeniyle 400 beklenebilir.
    if (response.status === 400) {
      localStorage.setItem("arti_url", projectUrl);
      localStorage.setItem("arti_key", apiKey);
      showMessage("connectionStatus", "Supabase bağlantısı hazır.");
      return;
    }

    if (!response.ok) {
      throw new Error(result?.message || "Hata kodu: " + response.status);
    }

    localStorage.setItem("arti_url", projectUrl);
    localStorage.setItem("arti_key", apiKey);

    showMessage("connectionStatus", "Supabase bağlantısı hazır.");
  } catch (error) {
    showMessage("connectionStatus", error.message);
  }
}

async function createRoom() {
  try {
    const result = await rpc("create_room");

    playerToken = result.player_token;
    playerNumber = Number(result.player_number);
    roomCode = result.room_code;

    notes = [];
    numberMarks = {};
    ownSecret = "";

    saveSession();
    loadNotes();

    $("connectionScreen").classList.add("hidden");
    $("gameScreen").classList.remove("hidden");

    showMessage("gameRoomInfo", "Oda kodu: " + roomCode);
    showMessage("roomStatus", "Oda oluşturuldu.");

    initializeGame();
    await refreshState();
  } catch (error) {
    showMessage("roomStatus", error.message);
  }
}

async function joinRoom() {
  const code = $("roomCode").value.trim().toUpperCase();

  if (!code) {
    showMessage("roomStatus", "Oda kodunu gir.");
    return;
  }

  try {
    const result = await rpc("join_room", {
      p_room_code: code
    });

    playerToken = result.player_token;
    playerNumber = Number(result.player_number);
    roomCode = result.room_code;

    notes = [];
    numberMarks = {};
    ownSecret = "";

    saveSession();
    loadNotes();

    $("connectionScreen").classList.add("hidden");
    $("gameScreen").classList.remove("hidden");

    showMessage("gameRoomInfo", "Oda kodu: " + roomCode);
    showMessage("roomStatus", "Odaya katıldın.");

    initializeGame();
    await refreshState();
  } catch (error) {
    showMessage("roomStatus", error.message);
  }
}

async function lockSecret() {
  const secret = $("secret").value.trim();

  if (!/^[1-9][0-9]{3}$/.test(secret) || new Set(secret).size !== 4) {
    showMessage("secretStatus", "İlk rakamı sıfır olmayan, dört farklı rakam gir.");
    return;
  }

  try {
    await rpc("lock_secret", {
      p_token: playerToken,
      p_secret: secret
    });

    ownSecret = secret;

    localStorage.setItem("arti_secret_" + playerToken, secret);

    $("secret").value = "";
    $("mySecretDisplay").textContent = ownSecret;
    $("secret").disabled = true;
    $("lockBtn").disabled = true;

    showMessage("secretStatus", "Sayın kilitlendi.");

    await refreshState();
  } catch (error) {
    showMessage("secretStatus", error.message);
  }
}

async function submitGuess() {
  const guess = $("guess").value.trim();

  if (!/^[1-9][0-9]{3}$/.test(guess) || new Set(guess).size !== 4) {
    showMessage("feedback", "İlk rakamı sıfır olmayan, dört farklı rakam gir.");
    return;
  }

  $("guessBtn").disabled = true;

  try {
    const result = await rpc("submit_guess", {
      p_token: playerToken,
      p_guess: guess
    });

    notes.push({
      guess,
      plus: Number(result.plus),
      minus: Number(result.minus)
    });

    saveNotes();

    $("guess").value = "";

    showMessage(
      "feedback",
      "+ " + result.plus + " / - " + result.minus
    );

    renderMyGuesses();
    await refreshState();
  } catch (error) {
    showMessage("feedback", error.message);
    $("guessBtn").disabled = false;
  }
}

async function refreshState() {
  if (!playerToken) return;

  try {
    const state = await rpc("get_game_state", {
      p_token: playerToken
    });

    gameState = state;

    renderOpponentGuesses(state.history || []);
    updateGameDisplay(state);
  } catch (error) {
    showMessage("feedback", error.message);
  }
}

function updateGameDisplay(state) {
  const status = String(state.status || "").toLowerCase();
  const turn = Number(state.turn);
  const winner = state.winner;
  const myTurn = turn === playerNumber;

  if (status === "waiting") {
    lastStatus = status;

    hideResultOverlay();

    showMessage("turn", "Rakip bekleniyor.");
    showMessage("coin", "İki oyuncu da sayısını kilitleyince oyun başlayacak.");

    $("guessBtn").disabled = true;
    return;
  }

  if (status === "playing") {
    if (lastStatus !== "playing") {
      showMessage("coin", "Oyun başladı!");
    }

    lastStatus = status;

    hideResultOverlay();

    showMessage("turn", myTurn ? "SIRA SENDE!" : "Rakibin sırası.");

    $("guessBtn").disabled = !myTurn || !ownSecret;
    return;
  }

  if (status === "last_chance") {
    lastStatus = status;

    // Son tahmin sırasında tam ekran pencere açılmaz.
    hideResultOverlay();

    if (myTurn) {
      showMessage("turn", "SON TAHMİNİNİ YAP!");
      $("guessBtn").disabled = !ownSecret;
    } else {
      showMessage("turn", "Rakibin son tahmin hakkını kullanıyor. Bekle!");
      $("guessBtn").disabled = true;
    }

    return;
  }

  if (status === "finished") {
    lastStatus = status;
    $("guessBtn").disabled = true;

    if (winner === null || winner === undefined) {
      showMessage("turn", "Oyun berabere bitti!");
      showResultOverlay("BERABERE!");
    } else if (Number(winner) === playerNumber) {
      showMessage("turn", "Oyunu kazandın!");
      showResultOverlay("KAZANDIN!");
    } else {
      showMessage("turn", "Oyunu kaybettin.");
      showResultOverlay("KAYBETTİN!");
    }

    return;
  }

  hideResultOverlay();
  showMessage("turn", "Oyun durumu kontrol ediliyor.");
  $("guessBtn").disabled = true;
}

function renderOpponentGuesses(history) {
  const opponent = history.filter(
    item => Number(item.player) !== playerNumber
  );

  const container = $("opponentGuesses");

  if (!opponent.length) {
    container.textContent = "Henüz rakip tahmini yok.";
    return;
  }

  container.innerHTML = "";

  opponent.forEach(item => {
    const row = document.createElement("div");
    row.className = "guess-row";

    for (const digit of item.guess) {
      const span = document.createElement("div");
      span.className = "guess-digit";
      span.textContent = digit;
      row.appendChild(span);
    }

    const result = document.createElement("span");
    result.textContent = " + " + item.plus + " / - " + item.minus;
    result.style.alignSelf = "center";
    result.style.marginLeft = "5px";

    row.appendChild(result);
    container.appendChild(row);
  });
}

function renderMyGuesses() {
  const container = $("myGuesses");

  if (!notes.length) {
    container.textContent = "Henüz tahmin yok.";
    return;
  }

  container.innerHTML = "";

  notes.forEach((note, index) => {
    const row = document.createElement("div");
    row.className = "guess-row";

    for (const digit of note.guess) {
      const span = document.createElement("div");
      span.className = "guess-digit";

      const color = numberMarks[index + "_" + digit];
      if (color) span.classList.add(color);

      span.textContent = digit;

      span.addEventListener("click", () => {
        const selected = $("color").value;
        const key = index + "_" + digit;

        if (numberMarks[key] === selected) {
          delete numberMarks[key];
        } else {
          numberMarks[key] = selected;
        }

        saveNotes();
        renderMyGuesses();
      });

      row.appendChild(span);
    }

    const result = document.createElement("span");
    result.textContent = " + " + note.plus + " / - " + note.minus;
    result.style.alignSelf = "center";
    result.style.marginLeft = "5px";

    row.appendChild(result);
    container.appendChild(row);
  });
}

function renderNumberBoard() {
  const board = $("numberBoard");
  board.innerHTML = "";

  for (let i = 0; i <= 9; i++) {
    const button = document.createElement("button");

    button.className = "digit";
    button.textContent = i;

    const color = numberMarks["number_" + i];
    if (color) button.classList.add(color);

    button.addEventListener("click", () => {
      const selected = $("color").value;
      const key = "number_" + i;

      if (numberMarks[key] === selected) {
        delete numberMarks[key];
      } else {
        numberMarks[key] = selected;
      }

      saveNotes();
      renderNumberBoard();
    });

    board.appendChild(button);
  }
}

function resetNotes() {
  numberMarks = {};
  saveNotes();
  renderMyGuesses();
  renderNumberBoard();
}

function setColor(color) {
  $("color").value = color;

  document.querySelectorAll(".color-choice").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.color === color
    );
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(() => {
    refreshState();
  }, 1500);
}

function initializeGame() {
  $("secret").disabled = Boolean(ownSecret);
  $("lockBtn").disabled = Boolean(ownSecret);

  $("mySecretDisplay").textContent = ownSecret || "----";

  renderMyGuesses();
  renderNumberBoard();
  setColor("red");
  startPolling();
}

function loadSession() {
  const saved = localStorage.getItem("arti_session");

  if (!saved) {
    $("projectUrl").value = localStorage.getItem("arti_url") || "";
    $("apiKey").value = localStorage.getItem("arti_key") || "";
    return;
  }

  try {
    const session = JSON.parse(saved);

    projectUrl = session.projectUrl || "";
    apiKey = session.apiKey || "";
    playerToken = session.playerToken || "";
    playerNumber = Number(session.playerNumber || 0);
    roomCode = session.roomCode || "";

    $("projectUrl").value = projectUrl;
    $("apiKey").value = apiKey;

    if (playerToken && roomCode) {
      loadNotes();

      $("connectionScreen").classList.add("hidden");
      $("gameScreen").classList.remove("hidden");

      showMessage("gameRoomInfo", "Oda kodu: " + roomCode);

      initializeGame();
      refreshState();
    }
  } catch {
    localStorage.removeItem("arti_session");
  }
}

function goBack() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  $("gameScreen").classList.add("hidden");
  $("connectionScreen").classList.remove("hidden");

  hideResultOverlay();
}

$("connectBtn").addEventListener("click", connect);
$("createRoomBtn").addEventListener("click", createRoom);
$("joinRoomBtn").addEventListener("click", joinRoom);
$("lockBtn").addEventListener("click", lockSecret);
$("guessBtn").addEventListener("click", submitGuess);
$("resetNotesBtn").addEventListener("click", resetNotes);
$("backBtn").addEventListener("click", goBack);

document.querySelectorAll(".color-choice").forEach(button => {
  button.addEventListener("click", () => {
    setColor(button.dataset.color);
  });
});

loadSession();
