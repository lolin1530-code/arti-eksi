
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

const $ = id => document.getElementById(id);

function setColor(color) {
  $("color").value = color;

  document.querySelectorAll(".color-choice").forEach(button => {
    const selected = button.dataset.color === color;
    button.classList.toggle("active", selected);
    button.style.outline = selected ? "4px solid white" : "none";
    button.style.filter = selected ? "brightness(1.15)" : "brightness(0.8)";
  });
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
  if (startMessageTimer) {
    clearTimeout(startMessageTimer);
    startMessageTimer = null;
  }

  startMessageShown = false;

  ownSecret = "";
  notes = [];
  numberMarks = {};

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

  $("coin").textContent = "";

  renderOwnSecret();
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

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || result.details || "Bağlantı hatası");
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
    await rpc("get_game_state", {
      p_token: "00000000-0000-0000-0000-000000000000"
    });
  } catch (error) {
    if (error.message.includes("Failed to fetch")) {
      $("connectionStatus").textContent = "Sunucuya ulaşılamadı.";
      return;
    }
  }

  $("connectionStatus").textContent = "Supabase bağlantısı hazır.";
}

async function createRoom() {
  try {
    const result = await rpc("create_room");

    playerToken = result.token || result.player_token;
    playerNumber = 1;
    roomCode = result.room_code;

    if (!playerToken || !roomCode) {
      throw new Error("Oda bilgileri alınamadı.");
    }

    notes = [];
    numberMarks = {};
    ownSecret = "";
    lastStatus = "";
    startMessageShown = false;

    saveSession();
    loadNotes();
    loadOwnSecret();
    showGameScreen();
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

    const result = await rpc("join_room", {
      p_room_code: code
    });

    playerToken = result.token || result.player_token;
    playerNumber = 2;
    roomCode = result.room_code || code;

    if (!playerToken) {
      throw new Error("Oyuncu bilgisi alınamadı.");
    }

    notes = [];
    numberMarks = {};
    ownSecret = "";
    lastStatus = "";
    startMessageShown = false;

    saveSession();
    loadNotes();
    loadOwnSecret();
    showGameScreen();
    startPolling();

    $("roomStatus").textContent = "Odaya katıldın.";
  } catch (error) {
    $("roomStatus").textContent = error.message;
  }
}

async function lockSecret() {
  const secret = $("secret").value.trim();

  if (!/^[1-9][0-9]{3}$/.test(secret) || new Set(secret).size !== 4) {
    $("secretStatus").textContent =
      "Dört farklı rakam gir. İlk rakam sıfır olamaz.";
    return;
  }

  try {
    await rpc("lock_secret", {
      p_token: playerToken,
      p_secret: secret
    });

    ownSecret = secret;
    saveOwnSecret();
    renderOwnSecret();

    $("secretStatus").textContent = "Sayın kilitlendi.";
    $("secret").disabled = true;
    $("lockBtn").disabled = true;

    if (secret === "8041") {
      showEasterEgg();
    }

    await refreshState();
  } catch (error) {
    $("secretStatus").textContent = error.message;
  }
}

function showEasterEgg() {
  $("easterEgg").classList.remove("hidden");
}

function closeEasterEgg() {
  $("easterEgg").classList.add("hidden");
}

async function submitGuess() {
  const guess = $("guess").value.trim();

  if (!/^[1-9][0-9]{3}$/.test(guess) || new Set(guess).size !== 4) {
    $("feedback").textContent =
      "Dört farklı rakam gir. İlk rakam sıfır olamaz.";
    return;
  }

  try {
    const result = await rpc("submit_guess", {
      p_token: playerToken,
      p_guess: guess
    });

    notes.push({
      guess,
      plus: result.plus,
      minus: result.minus,
      marks: {}
    });

    saveNotes();

    $("guess").value = "";

    $("feedback").textContent =
      "+" + result.plus + " doğru konum · -" +
      result.minus + " yanlış konum";

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
    const result = await rpc("get_restart_status", {
      p_token: playerToken
    });

    if (result.me) {
      $("restartBtn").disabled = true;
      $("restartBtn").textContent = "İSTEK GÖNDERİLDİ";

      $("restartStatus").textContent =
        "Rakibin de tekrar oynamasını bekliyorsun.";

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
    const result = await rpc("request_restart", {
      p_token: playerToken
    });

    if (result.restarted) {
      $("restartStatus").textContent = "Yeni oyun hazırlanıyor.";
      await refreshState();
    } else {
      $("restartBtn").textContent = "İSTEK GÖNDERİLDİ";
      $("restartStatus").textContent =
        "Rakibin de tekrar oynamasını bekliyorsun.";
      $("restartStatus").classList.remove("hidden");
    }

  } catch (error) {
    $("restartBtn").disabled = false;
    $("restartBtn").textContent = "TEKRAR OYNA";
    $("restartStatus").textContent = error.message;
    $("restartStatus").classList.remove("hidden");
  }
}

async function refreshState() {
  if (!playerToken) return;

  try {
    const state = await rpc("get_game_state", {
      p_token: playerToken
    });

    gameState = state;

    if (state.player !== undefined && state.player !== null) {
      playerNumber = Number(state.player);
      saveSession();
    }

    roomCode = state.room_code || roomCode;

    $("gameRoomInfo").textContent = "Oda kodu: " + roomCode;

    if (lastStatus === "finished" && state.status === "waiting") {
      clearRoundData();
    }

    const history = Array.isArray(state.history) ? state.history : [];

    if (state.status === "waiting") {
      if (startMessageTimer) {
        clearTimeout(startMessageTimer);
        startMessageTimer = null;
      }

      startMessageShown = false;

      $("guessBtn").disabled = true;
      hideGameResult();
      $("coin").textContent = "";

      if (!state.opponent_joined) {
        $("turn").textContent = "Rakip Bekleniyor";
        $("turn").style.color = "#ff5364";

      } else if (!ownSecret && !state.opponent_locked) {
        $("turn").textContent = "Gizli Sayıların Kitlenmesi Bekleniyor";
        $("turn").style.color = "#e8c34d";

      } else if (ownSecret && !state.opponent_locked) {
        $("turn").textContent = "Rakibin Gizli Sayısını Kilitlemesi Bekleniyor";
        $("turn").style.color = "#e8c34d";

      } else if (!ownSecret && state.opponent_locked) {
        $("turn").textContent = "Gizli Sayını Kilitlemen Bekleniyor";
        $("turn").style.color = "#e8c34d";

      } else {
        $("turn").textContent =
          "Taraflar Gizli Sayılarını Kilitledi, Başlayan Taraf Seçiliyor";
        $("turn").style.color = "#27c982";
      }

      if (!ownSecret) {
        $("secret").disabled = false;
        $("lockBtn").disabled = false;
      }

    } else if (state.status === "playing") {
      const myTurn = Number(state.turn) === playerNumber;

      $("guessBtn").disabled = !myTurn || !ownSecret;
      hideGameResult();
      $("coin").textContent = "";

      if (history.length > 0) {
        if (startMessageTimer) {
          clearTimeout(startMessageTimer);
          startMessageTimer = null;
        }

        startMessageShown = true;
        $("turn").textContent = "";
        $("turn").style.color = "";

      } else if (!startMessageShown && !startMessageTimer) {
        $("turn").textContent =
          "Taraflar Gizli Sayılarını Kilitledi, Başlayan Taraf Seçiliyor";
        $("turn").style.color = "#27c982";

        startMessageTimer = setTimeout(() => {
          startMessageTimer = null;

          if (
            gameState &&
            gameState.status === "playing" &&
            (!Array.isArray(gameState.history) || gameState.history.length === 0)
          ) {
            const currentTurn = Number(gameState.turn);

            if (currentTurn === playerNumber) {
              $("turn").textContent = "Tahmine Başla";
              $("turn").style.color = "#27c982";
            } else {
              $("turn").textContent = "Rakip Tahmine Başlıyor";
              $("turn").style.color = "#ff5364";
            }

            startMessageShown = true;
          }
        }, 1500);
      } else if (startMessageShown && history.length === 0) {
        if (myTurn) {
          $("turn").textContent = "Tahmine Başla";
          $("turn").style.color = "#27c982";
        } else {
          $("turn").textContent = "Rakip Tahmine Başlıyor";
          $("turn").style.color = "#ff5364";
        }
      }

    } else if (state.status === "last_chance") {
      const myTurn = Number(state.turn) === playerNumber;

      $("guessBtn").disabled = !myTurn || !ownSecret;

      $("gameResultBar").classList.remove("hidden");
      $("restartStatus").classList.add("hidden");
      $("restartBtn").classList.add("hidden");

      if (myTurn) {
        $("gameResultText").textContent = "SON ŞANSIN!";
        $("gameResultText").style.color = "#e8c34d";
        $("turn").textContent = "Sıra sende.";
      } else {
        $("gameResultText").textContent = "SON ŞANSINI DENİYOR!";
        $("gameResultText").style.color = "#e8c34d";
        $("turn").textContent = "Rakibin sırası.";
      }

    } else if (state.status === "finished") {
      $("guessBtn").disabled = true;
      $("gameResultBar").classList.remove("hidden");
      $("restartBtn").classList.remove("hidden");

      if (state.winner === null || state.winner === undefined) {
        $("turn").textContent = "Oyun sona erdi.";
        $("gameResultText").textContent = "BERABERE!";
        $("gameResultText").style.color = "#e8c34d";

      } else if (Number(state.winner) === playerNumber) {
        $("turn").textContent = "Oyun sona erdi.";
        $("gameResultText").textContent = "KAZANDIN!";
        $("gameResultText").style.color = "#27c982";

      } else {
        $("turn").textContent = "Oyun sona erdi.";
        $("gameResultText").textContent = "KAYBETTİN!";
        $("gameResultText").style.color = "#ff5364";
      }

      await updateRestartStatus();
    }

    lastStatus = state.status;

    if (Array.isArray(state.history)) {
      renderOpponentGuesses(state.history);
    }

    renderMyGuesses();

  } catch (error) {
    $("turn").textContent = error.message;
  }
}

function renderOwnSecret() {
  $("mySecretDisplay").textContent = ownSecret || "----";
}

function renderOpponentGuesses(history) {
  const list = $("opponentGuesses");
  list.innerHTML = "";

  const opponentHistory = history.filter(
    item => Number(item.player) !== playerNumber
  );

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
    return;
  }

  notes.forEach(item => {
    const row = document.createElement("div");
    row.className = "guess-row";

    for (let i = 0; i < 4; i++) {
      const cell = document.createElement("button");
      cell.className = "guess-digit";

      const mark = item.marks && item.marks[i];

      if (mark) {
        cell.classList.add(mark);
      }

      cell.textContent = item.guess[i];

      cell.onclick = () => {
        const color = $("color").value;
        item.marks = item.marks || {};

        if (item.marks[i] === color) {
          delete item.marks[i];
        } else {
          item.marks[i] = color;
        }

        saveNotes();
        renderMyGuesses();
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

function renderNumberBoard() {
  const board = $("numberBoard");
  board.innerHTML = "";

  for (let i = 0; i <= 9; i++) {
    const button = document.createElement("button");
    button.className = "digit";
    button.textContent = i;

    if (numberMarks[i]) {
      button.classList.add(numberMarks[i]);
    }

    button.onclick = () => {
      const color = $("color").value;

      if (color === "yellow") {
        $("feedback").textContent =
          "Rakam tahtasında kırmızı veya yeşil kullanabilirsin.";
        return;
      }

      if (numberMarks[i] === color) {
        delete numberMarks[i];
      } else {
        numberMarks[i] = color;
      }

      saveNotes();
      renderNumberBoard();
    };

    board.appendChild(button);
  }
}

function resetNotes() {
  if (!confirm("Bütün kişisel işaretlemelerin silinsin mi?")) {
    return;
  }

  notes.forEach(item => item.marks = {});
  numberMarks = {};

  saveNotes();
  renderMyGuesses();
  renderNumberBoard();
}

function startPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

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
}

function initializeGame() {
  $("gameScreen").classList.add("hidden");
  $("connectionScreen").classList.remove("hidden");

  $("connectBtn").addEventListener("click", connect);
  $("createRoomBtn").addEventListener("click", createRoom);
  $("joinRoomBtn").addEventListener("click", joinRoom);
  $("lockBtn").addEventListener("click", lockSecret);
  $("guessBtn").addEventListener("click", submitGuess);
  $("resetNotesBtn").addEventListener("click", resetNotes);

  $("restartBtn").addEventListener("click", requestRestart);
  $("closeEasterEgg").addEventListener("click", closeEasterEgg);

  document.querySelectorAll(".color-choice").forEach(button => {
    button.addEventListener("click", () => {
      setColor(button.dataset.color);
    });
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

  loadSession();
}

initializeGame();
