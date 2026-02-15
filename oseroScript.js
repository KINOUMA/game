
// --- グローバル変数 ---
let peer = null;
let conn = null;
let myColor = 1;        // 1: 黒(先手/Host), -1: 白(後手/Join)
let currentTurn = 1;    // 1: 黒, -1: 白
let board = [];         // 8x8配列 (0:空, 1:黒, -1:白)
let gameActive = false;
let lastMove = null;    // 直前の手 {x, y}

// PeerJS IDプレフィックス
const PREFIX = 'osero_v1_';

// 8方向のベクトル
const DIRECTIONS = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],          [1,  0],
    [-1,  1], [0,  1], [1,  1]
];

// --- 初期化 ---
window.onload = () => {
    // 画面初期化などはここ
};

// --- PeerJS 通信処理 ---
function log(msg) { document.getElementById('msg-log').innerText = msg; }

function startHosting() {
    const val = document.getElementById('room-id').value;
    if (val.length !== 4) return log('4桁のIDを入力してください');
    
    // ホストは常に黒（先手）とする（オセロの慣習）
    myColor = 1; 
    setupPeer(PREFIX + val, true);
}

function joinGame() {
    const val = document.getElementById('room-id').value;
    if (val.length !== 4) return log('4桁のIDを入力してください');
    
    // ゲストは常に白（後手）
    myColor = -1;
    setupPeer(null, false, PREFIX + val);
}

function setupPeer(id, isHost, targetId = null) {
    if (peer) peer.destroy();
    peer = id ? new Peer(id) : new Peer();

    log(isHost ? '部屋を作成中...' : '接続中...');

    peer.on('open', (myId) => {
        if (isHost) {
            log('待機中... ID: ' + myId.replace(PREFIX, ''));
            toggleInputs(false);
        } else {
            conn = peer.connect(targetId);
            setupConnection();
        }
    });

    peer.on('connection', (c) => {
        if (isHost) {
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
        // 接続完了したら即ゲーム開始
        startGame();
        if (myColor === 1) { // ホスト側から開始合図を送る
             conn.send({ type: 'start' });
        }
    });

    conn.on('data', (data) => {
        if (data.type === 'start') {
            startGame();
        } else if (data.type === 'move') {
            executeMove(data.x, data.y, -myColor, false); // 相手の手を実行
        }
    });

    conn.on('close', () => {
        if(gameActive) alert('相手が切断しました');
        location.reload();
    });
}

function sendMove(x, y) {
    if (conn && conn.open) conn.send({ type: 'move', x, y });
}

function toggleInputs(enable) {
    document.getElementById('room-id').disabled = !enable;
    document.querySelectorAll('.btn').forEach(b => b.disabled = !enable);
}

// --- ゲームコアロジック ---

function startGame() {
    gameActive = true;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    
    // プレイヤー情報表示
    const roleText = myColor === 1 ? 'あなたは 黒 (先手)' : 'あなたは 白 (後手)';
    document.getElementById('player-role').innerText = roleText;

    // 盤面初期化
    initBoard();
    render();
    checkPassOrEnd(); // 初手からパスはないはずだが、描画更新のため呼ぶ
}

function initBoard() {
    board = Array(8).fill(0).map(() => Array(8).fill(0));
    // 初期配置 (白:D4,E5 黒:E4,D5)
    // 配列インデックスは 0-7 なので、D4(3,3)=白, E4(4,3)=黒, D5(3,4)=黒, E5(4,4)=白
    board[3][3] = -1;
    board[4][4] = -1;
    board[3][4] = 1;
    board[4][3] = 1;
    
    currentTurn = 1; // 黒から
    lastMove = null;
}

// --- 描画処理 ---
function render() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';
    
    // スコア計算
    let blackCount = 0;
    let whiteCount = 0;

    // 現在の手番が置ける場所を計算
    const validMoves = getValidMoves(currentTurn);

    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            
            // 値チェック
            const val = board[y][x];
            if (val === 1) {
                blackCount++;
                const disc = document.createElement('div');
                disc.className = 'disc black';
                if(lastMove && lastMove.x === x && lastMove.y === y) disc.classList.add('new');
                cell.appendChild(disc);
            } else if (val === -1) {
                whiteCount++;
                const disc = document.createElement('div');
                disc.className = 'disc white';
                if(lastMove && lastMove.x === x && lastMove.y === y) disc.classList.add('new');
                cell.appendChild(disc);
            }

            // 直前の手のマスをハイライト
            if(lastMove && lastMove.x === x && lastMove.y === y) {
                cell.classList.add('last-move');
            }

            // ガイド表示 (自分のターン かつ 置ける場所)
            if (gameActive && currentTurn === myColor && val === 0) {
                if (validMoves.some(m => m.x === x && m.y === y)) {
                    cell.classList.add('valid');
                    if (myColor === -1) cell.classList.add('white-guide');
                    cell.onclick = () => onCellClick(x, y);
                }
            }

            boardEl.appendChild(cell);
        }
    }

    // スコア更新
    document.getElementById('score-black').innerText = blackCount;
    document.getElementById('score-white').innerText = whiteCount;

    // 手番表示更新
    const blackBox = document.getElementById('score-box-black');
    const whiteBox = document.getElementById('score-box-white');
    const statusMsg = document.getElementById('status-display');

    if (currentTurn === 1) {
        blackBox.classList.add('active');
        whiteBox.classList.remove('active');
        statusMsg.innerText = currentTurn === myColor ? 'あなたの番です' : '相手の番です';
    } else {
        blackBox.classList.remove('active');
        whiteBox.classList.add('active');
        statusMsg.innerText = currentTurn === myColor ? 'あなたの番です' : '相手の番です';
    }
}

// --- 操作ハンドラ ---
function onCellClick(x, y) {
    if (!gameActive || currentTurn !== myColor) return;
    
    // クライアント側でバリデーション
    if (isValidMove(x, y, myColor)) {
        executeMove(x, y, myColor, true);
    }
}

// --- 手の実行 ---
function executeMove(x, y, color, isSelf) {
    // 1. 石を置く
    board[y][x] = color;
    lastMove = { x, y };

    // 2. 裏返す
    const flipped = getFlippedDiscs(x, y, color);
    flipped.forEach(pos => {
        board[pos.y][pos.x] = color;
    });

    // 3. 通信 (自分の操作なら送信)
    if (isSelf) {
        sendMove(x, y);
    }

    // 4. ターン交代
    currentTurn = -currentTurn;
    
    // 5. パス判定・ゲーム終了判定・再描画
    checkPassOrEnd();
}

// --- ルール判定 (重要) ---

// 指定した場所に置いたときに裏返る石のリストを返す
function getFlippedDiscs(x, y, color) {
    let result = [];
    
    DIRECTIONS.forEach(dir => {
        let dx = dir[0];
        let dy = dir[1];
        let cx = x + dx;
        let cy = y + dy;
        let potential = [];

        while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8) {
            const val = board[cy][cx];
            
            if (val === 0) {
                // 空きマスならこの方向はNG
                return; 
            } else if (val === -color) {
                // 相手の石なら候補に追加して次へ
                potential.push({x: cx, y: cy});
            } else if (val === color) {
                // 自分の石に到達したら、候補を確定リストへ
                if (potential.length > 0) {
                    result = result.concat(potential);
                }
                return;
            }
            
            cx += dx;
            cy += dy;
        }
    });

    return result;
}

function isValidMove(x, y, color) {
    // 既に石があるならNG
    if (board[y][x] !== 0) return false;
    // 裏返せる石が1つ以上あるか
    const flipped = getFlippedDiscs(x, y, color);
    return flipped.length > 0;
}

function getValidMoves(color) {
    const moves = [];
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            if (isValidMove(x, y, color)) {
                moves.push({x, y});
            }
        }
    }
    return moves;
}

// パス判定とゲーム終了判定
function checkPassOrEnd() {
    render();

    // 現在の手番プレイヤーが置ける場所があるか
    const currentMoves = getValidMoves(currentTurn);
    if (currentMoves.length > 0) {
        // 置ける場所があるので続行
        return;
    }

    // 現在のプレイヤーは置けない -> パス
    // では、相手（次のプレイヤー）は置けるか？
    const nextTurn = -currentTurn;
    const nextMoves = getValidMoves(nextTurn);

    if (nextMoves.length === 0) {
        // 両者置けない -> ゲーム終了
        endGame();
    } else {
        // 片方だけパス
        const playerName = currentTurn === 1 ? "黒" : "白";
        alert(`${playerName}は置ける場所がないためパスします。`);
        currentTurn = nextTurn;
        render();
    }
}

function endGame() {
    gameActive = false;
    let black = 0;
    let white = 0;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            if (board[y][x] === 1) black++;
            else if (board[y][x] === -1) white++;
        }
    }

    const modal = document.getElementById('result-modal');
    const scoreText = document.getElementById('result-score');
    const msg = document.getElementById('result-message');

    scoreText.innerText = `黒: ${black} - 白: ${white}`;

    if (black > white) {
        msg.innerText = "黒の勝ち！";
        msg.style.color = "#444";
    } else if (white > black) {
        msg.innerText = "白の勝ち！";
        msg.style.color = "#444";
    } else {
        msg.innerText = "引き分け！";
    }

    modal.style.display = 'flex';
}
