// --- グローバル変数 ---
let peer = null;
let conn = null;
let isHost = false;
let gameActive = false;

// キャンバス設定
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let tableWidth, tableHeight;

// ゲーム定数
const GOAL_SCORE = 7;
const TIME_LIMIT = 180; // 3分 (秒)
const FPS = 60;

// 比率設定 (画面幅基準)
const PUCK_RADIUS_RATIO = 0.035;
const PADDLE_RADIUS_RATIO = 0.07;
const GOAL_WIDTH_RATIO = 0.4;

// ゲーム状態
let gameState = {
    puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    hostPaddle: { x: 0.5, y: 0.9 }, // 下側
    guestPaddle: { x: 0.5, y: 0.1 }, // 上側
    score: { host: 0, guest: 0 },
    timeLeft: TIME_LIMIT
};

let myInput = { x: 0.5, y: 0.5, active: false };

// PeerJS 設定
const PREFIX = 'hockey_mob_v2_';

// --- 初期化 ---
window.onload = () => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    setupInput();
    requestAnimationFrame(gameLoop);
};

function resizeCanvas() {
    // コンテナのサイズを取得してCanvasを合わせる
    const wrapper = document.querySelector('.canvas-wrapper');
    const rect = wrapper.getBoundingClientRect();
    
    // 少し余白を持たせる
    tableWidth = rect.width;
    tableHeight = rect.height;

    canvas.width = tableWidth;
    canvas.height = tableHeight;
}

// --- 通信 (PeerJS) ---
function log(msg) { document.getElementById('msg-log').innerText = msg; }

function startHosting() {
    const val = document.getElementById('room-id').value;
    if (val.length !== 4) return log('4桁のIDを入力してください');
    isHost = true;
    setupPeer(PREFIX + val, true);
}

function joinGame() {
    const val = document.getElementById('room-id').value;
    if (val.length !== 4) return log('4桁のIDを入力してください');
    isHost = false;
    setupPeer(null, false, PREFIX + val);
}

function setupPeer(id, hostMode, targetId = null) {
    if (peer) peer.destroy();
    peer = id ? new Peer(id) : new Peer();

    log(hostMode ? '部屋を作成中...' : '接続中...');

    peer.on('open', (myId) => {
        if (hostMode) {
            log('待機中... ID: ' + myId.replace(PREFIX, ''));
            toggleInputs(false);
        } else {
            conn = peer.connect(targetId);
            setupConnection();
        }
    });

    peer.on('connection', (c) => {
        if (hostMode) {
            conn = c;
            setupConnection();
        }
    });

    peer.on('error', (err) => {
        log('エラー: ' + err.type);
        toggleInputs(true);
    });
}

function setupConnection() {
    conn.on('open', () => {
        log('接続成功！');
        startGame();
    });

    conn.on('data', (data) => {
        if (isHost) {
            if (data.type === 'input') {
                // ゲストは視点が逆なので座標を反転して受け取る
                gameState.guestPaddle.x = 1.0 - data.x;
                gameState.guestPaddle.y = 1.0 - data.y;
            }
        } else {
            if (data.type === 'state') {
                gameState = data.state;
                updateUI();
                checkGameOver();
            }
        }
    });

    conn.on('close', () => {
        if(gameActive) alert('切断されました');
        location.reload();
    });
}

function toggleInputs(enable) {
    document.getElementById('room-id').disabled = !enable;
    document.querySelectorAll('.btn').forEach(b => b.disabled = !enable);
}

// --- ゲーム開始 ---
function startGame() {
    gameActive = true;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    resizeCanvas(); // レイアウト確定後に再リサイズ
    
    // 初期化
    gameState = {
        puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
        hostPaddle: { x: 0.5, y: 0.9 },
        guestPaddle: { x: 0.5, y: 0.1 },
        score: { host: 0, guest: 0 },
        timeLeft: TIME_LIMIT
    };
}

// --- 入力処理 ---
function setupInput() {
    const handleMove = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        let nx = (clientX - rect.left) / tableWidth;
        let ny = (clientY - rect.top) / tableHeight;

        // 範囲制限
        nx = Math.max(0, Math.min(1, nx));
        ny = Math.max(0, Math.min(1, ny));

        // 操作エリア制限（自分は常に下半分で操作）
        if (ny < 0.5) ny = 0.5;

        myInput.x = nx;
        myInput.y = ny;
        myInput.active = true;
    };

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    // PCデバッグ用
    canvas.addEventListener('mousemove', (e) => {
        if(e.buttons === 1) handleMove(e.clientX, e.clientY);
    });
    canvas.addEventListener('mousedown', (e) => handleMove(e.clientX, e.clientY));
}

// --- ゲームループ ---
function gameLoop() {
    if (gameActive) {
        if (isHost) {
            updatePhysics();
            sendState();
        } else {
            sendInput();
        }
        // ホスト側UI更新
        if(isHost) {
            updateUI();
            checkGameOver();
        }
    }
    draw();
    requestAnimationFrame(gameLoop);
}

// --- 物理演算 (Hostのみ) ---
function updatePhysics() {
    // タイマー減算 (約60FPS)
    gameState.timeLeft -= 1/60;
    if(gameState.timeLeft < 0) gameState.timeLeft = 0;

    // パドル位置更新
    if (myInput.active) {
        gameState.hostPaddle.x = myInput.x;
        gameState.hostPaddle.y = myInput.y;
    }

    const puck = gameState.puck;
    
    // パック移動
    puck.x += puck.vx;
    puck.y += puck.vy;
    
    // 摩擦
    puck.vx *= 0.99;
    puck.vy *= 0.99;

    // 壁反射
    if (puck.x <= 0 || puck.x >= 1) {
        puck.vx *= -1;
        puck.x = Math.max(0, Math.min(1, puck.x));
    }

    // ゴール判定エリア
    const gw = GOAL_WIDTH_RATIO / 2;

    // 上の壁 (Guestゴール)
    if (puck.y <= 0) {
        if (puck.x > 0.5 - gw && puck.x < 0.5 + gw) {
            scorePoint('host'); // Hostの得点
        } else {
            puck.vy *= -1;
            puck.y = 0;
        }
    }
    // 下の壁 (Hostゴール)
    if (puck.y >= 1) {
        if (puck.x > 0.5 - gw && puck.x < 0.5 + gw) {
            scorePoint('guest'); // Guestの得点
        } else {
            puck.vy *= -1;
            puck.y = 1;
        }
    }

    // パドル衝突
    checkCollision(gameState.hostPaddle);
    checkCollision(gameState.guestPaddle);
}

function checkCollision(paddle) {
    const puck = gameState.puck;
    
    // 実際の距離計算
    let dx = (puck.x - paddle.x) * tableWidth;
    let dy = (puck.y - paddle.y) * tableHeight;
    let dist = Math.sqrt(dx*dx + dy*dy);
    
    let rSum = (PUCK_RADIUS_RATIO + PADDLE_RADIUS_RATIO) * tableWidth;

    if (dist < rSum) {
        // 衝突
        let nx = dx / dist;
        let ny = dy / dist;
        
        // 押し出し
        let push = (rSum - dist);
        puck.x += (nx * push) / tableWidth;
        puck.y += (ny * push) / tableHeight;
        
        // 反発
        const bounce = 0.03; // 力の強さ
        puck.vx += nx * bounce;
        puck.vy += ny * bounce;
        
        // 速度制限
        const maxSpeed = 0.05; // 画面比率に対する速度
        let spd = Math.sqrt(puck.vx*puck.vx + puck.vy*puck.vy);
        if(spd > maxSpeed) {
            puck.vx = (puck.vx/spd) * maxSpeed;
            puck.vy = (puck.vy/spd) * maxSpeed;
        }
    }
}

function scorePoint(winner) {
    if (winner === 'host') gameState.score.host++;
    else gameState.score.guest++;
    
    // リセット
    gameState.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
    // サーブ権: 失点した側に少し寄せるなどしてもよいが、中央固定にする
    // パドルの位置はリセットしない（操作性を損なうため）
}

// --- 通信 ---
function sendState() {
    if (conn && conn.open) conn.send({ type: 'state', state: gameState });
}

function sendInput() {
    if (conn && conn.open && myInput.active) {
        conn.send({ type: 'input', x: myInput.x, y: myInput.y });
    }
}

// --- UI更新 ---
function updateUI() {
    // スコア表示 (自分のスコアを下に、相手を上に)
    const myScore = isHost ? gameState.score.host : gameState.score.guest;
    const oppScore = isHost ? gameState.score.guest : gameState.score.host;
    
    document.getElementById('score-self').innerText = myScore;
    document.getElementById('score-opponent').innerText = oppScore;

    // タイマー表示
    const t = Math.ceil(gameState.timeLeft);
    const m = Math.floor(t / 60);
    const s = t % 60;
    document.getElementById('timer-display').innerText = 
        `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

// --- 描画処理 ---
function draw() {
    ctx.clearRect(0, 0, tableWidth, tableHeight);

    // センターライン
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, tableHeight/2);
    ctx.lineTo(tableWidth, tableHeight/2);
    ctx.stroke();

    // センターサークル
    ctx.beginPath();
    ctx.arc(tableWidth/2, tableHeight/2, tableWidth*0.2, 0, Math.PI*2);
    ctx.stroke();

    // ゴール
    const gw = tableWidth * GOAL_WIDTH_RATIO;
    ctx.fillStyle = '#111';
    ctx.fillRect((tableWidth - gw)/2, 0, gw, 10);
    ctx.fillRect((tableWidth - gw)/2, tableHeight-10, gw, 10);

    // 座標変換 (Guestなら180度回転して描画)
    const tx = (x) => isHost ? x * tableWidth : (1-x) * tableWidth;
    const ty = (y) => isHost ? y * tableHeight : (1-y) * tableHeight;

    // パック
    ctx.beginPath();
    ctx.arc(tx(gameState.puck.x), ty(gameState.puck.y), tableWidth * PUCK_RADIUS_RATIO, 0, Math.PI*2);
    ctx.fillStyle = '#0f0';
    ctx.shadowBlur = 20; ctx.shadowColor = '#0f0';
    ctx.fill();
    ctx.shadowBlur = 0;

    // パドル (Host: 青, Guest: 赤)
    // Host Paddle
    ctx.beginPath();
    ctx.arc(tx(gameState.hostPaddle.x), ty(gameState.hostPaddle.y), tableWidth * PADDLE_RADIUS_RATIO, 0, Math.PI*2);
    ctx.fillStyle = '#0f3460'; ctx.strokeStyle = '#4db6ac'; ctx.lineWidth = 3;
    ctx.fill(); ctx.stroke();

    // Guest Paddle
    ctx.beginPath();
    ctx.arc(tx(gameState.guestPaddle.x), ty(gameState.guestPaddle.y), tableWidth * PADDLE_RADIUS_RATIO, 0, Math.PI*2);
    ctx.fillStyle = '#e94560'; ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 3;
    ctx.fill(); ctx.stroke();
}

function checkGameOver() {
    if(!gameActive) return;

    const myScore = isHost ? gameState.score.host : gameState.score.guest;
    const oppScore = isHost ? gameState.score.guest : gameState.score.host;
    let isOver = false;
    let win = false;

    // 条件1: 7点先取
    if (myScore >= GOAL_SCORE) { isOver = true; win = true; }
    else if (oppScore >= GOAL_SCORE) { isOver = true; win = false; }
    
    // 条件2: 時間切れ
    else if (gameState.timeLeft <= 0) {
        isOver = true;
        if (myScore > oppScore) win = true;
        else if (myScore < oppScore) win = false;
        else win = null; // 引き分け
    }

    if (isOver) {
        gameActive = false;
        const modal = document.getElementById('result-modal');
        const title = document.getElementById('result-title');
        const scoreTxt = document.getElementById('final-score-text');
        const msg = document.getElementById('result-message');

        scoreTxt.innerText = `${myScore} - ${oppScore}`;

        if (win === true) {
            title.innerText = "VICTORY!";
            title.style.color = "#0f0";
            msg.innerText = "おめでとうございます！";
        } else if (win === false) {
            title.innerText = "DEFEAT...";
            title.style.color = "#f00";
            msg.innerText = "ドンマイ！";
        } else {
            title.innerText = "DRAW";
            title.style.color = "#fff";
            msg.innerText = "引き分けです";
        }
        
        modal.style.display = 'flex';
    }
}
