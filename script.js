// --- グローバル変数 ---
let peer = null;
let conn = null;
let myColor = null;       // 'black' or 'white'
let currentTurn = 'black';
let boardState = [];      // 9x9配列
let hands = { black: {}, white: {} };
let selectedCell = null;  // {x, y} or {isHand, type, color}
let pendingMove = null;   // 成り保留中の移動データ
let lastMovePos = null;

// --- 定数・設定 ---
const pieceDefs = {
    'P': { name: '歩', pro: 'と', canPro: true },
    'L': { name: '香', pro: '杏', canPro: true },
    'N': { name: '桂', pro: '圭', canPro: true },
    'S': { name: '銀', pro: '全', canPro: true },
    'G': { name: '金', pro: null, canPro: false },
    'B': { name: '角', pro: '馬', canPro: true },
    'R': { name: '飛', pro: '龍', canPro: true },
    'K': { name: '王', pro: null, canPro: false }
};

// 初期配置 (上が後手y=0, 下が先手y=8)
const initialPlacement = [
    ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'], 
    [' ', 'R', ' ', ' ', ' ', ' ', ' ', 'B', ' '], 
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'], 
    [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'], 
    [' ', 'B', ' ', ' ', ' ', ' ', ' ', 'R', ' '], 
    ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L']  
];

// --- 初期化 ---
window.onload = () => {
    // モーダルボタンのイベントをここで確実に登録
    document.getElementById('btn-promote-yes').onclick = () => resolvePromotion(true);
    document.getElementById('btn-promote-no').onclick = () => resolvePromotion(false);
};

// --- 通信関連 (PeerJS) ---
const PREFIX = 'shogi_v2_';

function log(msg) {
    const el = document.getElementById('msg-log');
    el.innerText = msg;
}

function startHosting() {
    const input = document.getElementById('room-id').value;
    if (input.length !== 4) return log('4桁のIDを入力してください');
    
    setupPeer(PREFIX + input, true);
}

function joinGame() {
    const input = document.getElementById('room-id').value;
    if (input.length !== 4) return log('4桁のIDを入力してください');

    setupPeer(null, false, PREFIX + input);
}

function setupPeer(id, isHost, targetId = null) {
    log(isHost ? '部屋を作成中...' : '接続中...');
    
    // 既存の接続があれば切る
    if (peer) peer.destroy();

    peer = id ? new Peer(id) : new Peer();

    peer.on('open', (myId) => {
        if (isHost) {
            log(`部屋作成成功 ID:${id.replace(PREFIX,'')}\n待機中...`);
            disableLoginInputs();
            myColor = 'black';
        } else {
            // ゲストは即接続
            conn = peer.connect(targetId);
            setupConnection();
        }
    });

    peer.on('connection', (connection) => {
        if (isHost) {
            conn = connection;
            setupConnection();
            log('対戦相手が入室しました');
            startGame();
        }
    });

    peer.on('error', (err) => {
        console.error(err);
        if (err.type === 'unavailable-id') {
            log('そのIDは使用されています');
        } else if (err.type === 'peer-unavailable') {
            log('部屋が見つかりません');
        } else {
            log('通信エラー: ' + err.type);
        }
        enableLoginInputs();
    });
}

function setupConnection() {
    if (!conn) return;
    
    conn.on('open', () => {
        if (myColor === 'black') {
            // ホスト側は何もしない（connectionイベントで開始済み）
        } else {
            myColor = 'white';
            log('接続成功！');
            startGame();
        }
    });

    conn.on('data', (data) => {
        handleRemoteData(data);
    });

    conn.on('close', () => {
        alert('相手との接続が切れました');
        resetGame();
    });
}

function sendData(data) {
    if (conn && conn.open) {
        conn.send(data);
    }
}

function disableLoginInputs() {
    document.getElementById('room-id').disabled = true;
    document.querySelectorAll('.btn').forEach(b => b.disabled = true);
}
function enableLoginInputs() {
    document.getElementById('room-id').disabled = false;
    document.querySelectorAll('.btn').forEach(b => b.disabled = false);
}

// --- ゲーム進行 ---

function startGame() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    initBoard();
}

function resetGame() {
    location.reload();
}

function initBoard() {
    boardState = Array(9).fill(null).map(() => Array(9).fill(null));
    hands = { black: {}, white: {} };
    // 持ち駒初期化
    Object.keys(pieceDefs).forEach(k => {
        hands.black[k] = 0;
        hands.white[k] = 0;
    });

    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            const char = initialPlacement[y][x];
            if (char !== ' ') {
                const owner = y <= 2 ? 'white' : 'black';
                boardState[y][x] = { type: char, owner: owner, promoted: false };
            }
        }
    }
    render();
    updateStatus();
}

// --- 描画処理 ---
function render() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';
    
    // 後手視点の回転
    if (myColor === 'white') {
        boardEl.classList.add('board-rotated');
    } else {
        boardEl.classList.remove('board-rotated');
    }

    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            
            // ハイライト
            if (selectedCell && !selectedCell.isHand && selectedCell.x === x && selectedCell.y === y) {
                cell.classList.add('selected');
            }
            if (lastMovePos && lastMovePos.toX === x && lastMovePos.toY === y) {
                cell.classList.add('last-move');
            }

            // クリックイベント
            cell.onclick = () => onCellClick(x, y);

            const p = boardState[y][x];
            if (p) {
                const div = document.createElement('div');
                div.className = `piece ${p.owner} ${p.promoted ? 'promoted' : ''}`;
                const def = pieceDefs[p.type];
                div.innerText = p.promoted ? def.pro : def.name;
                cell.appendChild(div);
            }
            boardEl.appendChild(cell);
        }
    }
    renderHand('black');
    renderHand('white');
}

function renderHand(color) {
    const container = document.getElementById(`komadai-${color}`);
    container.innerHTML = '';
    
    Object.keys(hands[color]).forEach(type => {
        const count = hands[color][type];
        if (count > 0) {
            const div = document.createElement('div');
            div.className = 'hand-piece piece ' + color;
            
            // 選択状態
            if (selectedCell && selectedCell.isHand && selectedCell.type === type && selectedCell.color === color) {
                div.classList.add('selected');
            }

            const def = pieceDefs[type];
            div.innerText = def.name;
            
            if (count > 1) {
                const badge = document.createElement('span');
                badge.className = 'count-badge';
                badge.innerText = count;
                div.appendChild(badge);
            }

            div.onclick = (e) => {
                e.stopPropagation(); // 親への伝播防止
                onHandClick(type, color);
            };
            container.appendChild(div);
        }
    });
}

function updateStatus() {
    const el = document.getElementById('turn-indicator');
    const isMyTurn = myColor === currentTurn;
    const turnText = currentTurn === 'black' ? '先手' : '後手';
    
    el.innerText = `${turnText}の番 ${isMyTurn ? '(あなた)' : ''}`;
    if (isMyTurn) el.classList.add('my-turn');
    else el.classList.remove('my-turn');
}

// --- 操作ロジック ---

function onHandClick(type, color) {
    if (myColor !== currentTurn) return;
    if (color !== myColor) return; // 相手の持ち駒は触れない

    // 同じ駒を再度クリックで解除
    if (selectedCell && selectedCell.isHand && selectedCell.type === type) {
        selectedCell = null;
    } else {
        selectedCell = { isHand: true, type, color };
    }
    render();
}

function onCellClick(x, y) {
    if (myColor !== currentTurn) return;

    const target = boardState[y][x];

    // 1. 持ち駒を選択中 -> 打つ
    if (selectedCell && selectedCell.isHand) {
        if (!target) {
            tryDrop(selectedCell.type, x, y);
        }
        return;
    }

    // 2. 盤上の駒を選択中 -> 移動
    if (selectedCell && !selectedCell.isHand) {
        // 同じマス -> 解除
        if (selectedCell.x === x && selectedCell.y === y) {
            selectedCell = null;
            render();
            return;
        }
        // 自分の他の駒 -> 選択切り替え
        if (target && target.owner === myColor) {
            selectedCell = { x, y };
            render();
            return;
        }
        // 移動または取る
        tryMove(selectedCell.x, selectedCell.y, x, y);
        return;
    }

    // 3. 何も選択してない -> 自分の駒を選択
    if (target && target.owner === myColor) {
        selectedCell = { x, y };
        render();
    }
}

// --- 移動処理 ---

function tryMove(fx, fy, tx, ty) {
    const p = boardState[fy][fx];
    if (!canMove(p, fx, fy, tx, ty, boardState)) return;

    const def = pieceDefs[p.type];
    const isPromotable = def.canPro && !p.promoted;
    
    // ゾーン判定
    const isBlack = p.owner === 'black';
    const enterZone = isBlack ? ty <= 2 : ty >= 6;
    const leaveZone = isBlack ? fy <= 2 : fy >= 6;
    const inZone = enterZone || leaveZone;

    if (isPromotable && inZone) {
        // 強制成りの判定（行き所のない駒）
        const isForcePromote = checkForcePromote(p.type, isBlack, ty);
        
        if (isForcePromote) {
            executeMove(fx, fy, tx, ty, true);
        } else {
            // ユーザー選択
            pendingMove = { fx, fy, tx, ty };
            showModal();
        }
    } else {
        executeMove(fx, fy, tx, ty, false);
    }
}

function checkForcePromote(type, isBlack, y) {
    // 歩・香：1段目(0 or 8)に行ったら強制
    if (type === 'P' || type === 'L') {
        return isBlack ? y === 0 : y === 8;
    }
    // 桂：1,2段目(0,1 or 7,8)に行ったら強制
    if (type === 'N') {
        return isBlack ? y <= 1 : y >= 7;
    }
    return false;
}

function showModal() {
    document.getElementById('promote-modal').style.display = 'flex';
}

function resolvePromotion(result) {
    document.getElementById('promote-modal').style.display = 'none';
    if (pendingMove) {
        executeMove(pendingMove.fx, pendingMove.fy, pendingMove.tx, pendingMove.ty, result);
        pendingMove = null;
    }
}

function executeMove(fx, fy, tx, ty, promote) {
    const p = boardState[fy][fx];
    const target = boardState[ty][tx];

    // 取る処理
    if (target) {
        const capturedType = target.type; // そのままの種類で持ち駒へ
        hands[myColor][capturedType] = (hands[myColor][capturedType] || 0) + 1;
    }

    boardState[ty][tx] = {
        type: p.type,
        owner: p.owner,
        promoted: p.promoted || promote
    };
    boardState[fy][fx] = null;

    finishTurn({ type: 'move', fx, fy, tx, ty, promote });
}

function tryDrop(type, x, y) {
    // 禁止手チェック
    // 1. 二歩
    if (type === 'P') {
        for (let r = 0; r < 9; r++) {
            const t = boardState[r][x];
            if (t && t.owner === myColor && t.type === 'P' && !t.promoted) {
                alert('二歩です');
                return;
            }
        }
    }
    // 2. 行き所のない駒打ち
    const isBlack = myColor === 'black';
    if (type === 'P' || type === 'L') {
        if ((isBlack && y === 0) || (!isBlack && y === 8)) return;
    }
    if (type === 'N') {
        if ((isBlack && y <= 1) || (!isBlack && y >= 7)) return;
    }

    boardState[y][x] = { type, owner: myColor, promoted: false };
    hands[myColor][type]--;

    finishTurn({ type: 'drop', piece: type, tx: x, ty: y });
}

function finishTurn(moveData) {
    selectedCell = null;
    lastMovePos = { toX: moveData.tx, toY: moveData.ty };
    render();
    
    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    updateStatus();
    sendData(moveData);
}

function handleRemoteData(data) {
    if (data.type === 'move') {
        const { fx, fy, tx, ty, promote } = data;
        const p = boardState[fy][fx];
        const target = boardState[ty][tx];

        if (target) {
            hands[currentTurn][target.type]++;
        }
        boardState[ty][tx] = {
            type: p.type,
            owner: p.owner,
            promoted: p.promoted || promote
        };
        boardState[fy][fx] = null;

    } else if (data.type === 'drop') {
        const { piece, tx, ty } = data;
        boardState[ty][tx] = { type: piece, owner: currentTurn, promoted: false };
        hands[currentTurn][piece]--;
    }

    lastMovePos = { toX: data.tx, toY: data.ty };
    
    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    render();
    updateStatus();
}

// --- 駒の移動判定 (重要) ---
function canMove(p, fx, fy, tx, ty, board) {
    const dx = tx - fx;
    const dy = ty - fy;
    const isBlack = p.owner === 'black';
    
    // 味方の駒の上には移動不可
    const target = board[ty][tx];
    if (target && target.owner === p.owner) return false;

    // 定義を黒視点に統一 (白の場合はdyを反転させて判定)
    const checkDy = isBlack ? dy : -dy; 
    const checkDx = dx; 

    // 金の動き（共通）
    const goldMoves = [[-1,-1], [0,-1], [1,-1], [-1,0], [1,0], [0,1]];
    
    // 成り駒は金と同じ動き（王、飛、角を除く）
    if (p.promoted) {
        if (['P','L','N','S'].includes(p.type)) {
            return goldMoves.some(m => m[0] === checkDx && m[1] === checkDy);
        }
    }

    switch (p.type) {
        case 'P': return checkDx === 0 && checkDy === -1;
        
        case 'L': // 香車
            if (checkDx !== 0 || checkDy >= 0) return false;
            // 間のチェック
            const dist = Math.abs(dy);
            const step = dy > 0 ? 1 : -1;
            for (let i = 1; i < dist; i++) {
                if (board[fy + i * step][fx]) return false;
            }
            return true;

        case 'N': // 桂馬
            return (checkDx === -1 || checkDx === 1) && checkDy === -2;

        case 'S': // 銀
            const silverMoves = [[-1,-1], [0,-1], [1,-1], [-1,1], [1,1]];
            return silverMoves.some(m => m[0] === checkDx && m[1] === checkDy);

        case 'G': return goldMoves.some(m => m[0] === checkDx && m[1] === checkDy);

        case 'K': // 王
            return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;

        case 'R': // 飛・龍
        case 'B': // 角・馬
            return checkSliding(p.type, p.promoted, fx, fy, tx, ty, board);
    }
    return false;
}

function checkSliding(type, isPromoted, fx, fy, tx, ty, board) {
    const dx = tx - fx;
    const dy = ty - fy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    const isOrtho = (dx === 0 || dy === 0);
    const isDiag = (adx === ady);
    const isKingMove = (adx <= 1 && ady <= 1);

    if (type === 'R') {
        if (isPromoted && isKingMove) return true; // 龍の追加移動
        if (!isOrtho) return false;
    } else { // 'B'
        if (isPromoted && isKingMove) return true; // 馬の追加移動
        if (!isDiag) return false;
    }

    // 間に駒があるかチェック
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    let cx = fx + sx;
    let cy = fy + sy;

    while (cx !== tx || cy !== ty) {
        if (board[cy][cx]) return false;
        cx += sx;
        cy += sy;
    }
    return true;
}
