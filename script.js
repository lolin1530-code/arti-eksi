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

  $("connectionStatus").textContent = "Bağlantı hazır.";
}

async function createRoom() {
  try {
    const result = await rpc("create_room");

    playerToken = result.token || result.player_token;
    playerNumber = 1;
    roomCode = result.room_code;

    if (!playerToken || !roomCode) throw new Error("Oda bilgileri alınamadı.");

    notes = [];
    numberMarks = {};
    ownSecret = "";

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

    const result = await rpc("join_room", { p_room_code: code });

    playerToken = result.token || result.player_token;
    playerNumber = 2;
    roomCode = result.room_code || code;

    if (!playerToken) throw new Error("Oyuncu bilgisi alınamadı.");

    notes = [];
    numberMarks = {};
    ownSecret = "";

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

    await refreshState();
  } catch (error) {
    $("secretStatus").textContent = error.message;
  }
}

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

async function refreshState() {
  if (!playerToken) return;

  try {
    const state = await rpc("get_game_state", { p_token: playerToken });
    gameState = state;

    $("gameRoomInfo").textContent = "Oda kodu: " + (state.room_code || roomCode);

    if (state.status === "waiting") {
      $("turn").textContent = "Rakip bekleniyor.";
      $("guessBtn").disabled = true;
    } else if (state.status === "playing") {
      const myTurn = Number(state.turn) === playerNumber;
      $("turn").textContent = myTurn ? "Sıra sende!" : "Rakibin sırası.";
      $("guessBtn").disabled = !myTurn || !ownSecret;
    } else if (state.status === "finished") {
      $("turn").textContent = Number(state.winner) === playerNumber ? "Kazandın!" : "Rakibin kazandı!";
      $("guessBtn").disabled = true;
    }

    if (state.opponent_locked) {
      $("coin").textContent = "İki oyuncu da sayısını kilitledi.";
    }

    if (state.status === "playing" && lastStatus !== "playing") {
      $("coin").textContent = "🪙 Oyuna başlayan: Oyuncu " + state.turn;
    }

    lastStatus = state.status;

    if (Array.isArray(state.history)) renderOpponentGuesses(state.history);
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

  history.filter(item => Number(item.player) !== playerNumber).forEach(item => {
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
