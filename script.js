// --- グローバル変数 ---
let peer = null;
let conn = null;
let myColor = null;       // 'black'(先手) or 'white'(後手)
let currentTurn = 'black'; // 常にblack(先手)から開始
let boardState = [];
let hands = { black: {}, white: {} };
let selectedCell = null;
let pendingMove = null;
let lastMovePos = null;

// --- 駒定義 ---
// 玉(K)を確実に定義。先手は'玉'、後手は'王'と表示し分けるロジックを追加
const pieceDefs = {
    'P': { name: '歩', pro: 'と', canPro: true },
    'L': { name: '香', pro: '杏', canPro: true },
    'N': { name: '桂', pro: '圭', canPro: true },
    'S': { name: '銀', pro: '全', canPro: true },
    'G': { name: '金', pro: null, canPro: false },
    'B': { name: '角', pro: '馬', canPro: true },
    'R': { name: '飛', pro: '龍', canPro: true },
    'K': { name: '王', pro: null, canPro: false } // 表示時に先手なら玉に変更
};

const initialPlacement = [
    ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'], // 0段目(後手)
    [' ', 'R', ' ', ' ', ' ', ' ', ' ', 'B', ' '], 
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'], 
    [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'], 
    [' ', 'B', ' ', ' ', ' ', ' ', ' ', 'R', ' '], 
    ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L']  // 8段目(先手)
];

// --- 初期化 ---
window.onload = () => {
    // モーダルボタンのイベント登録
    document.getElementById('btn-promote-yes').onclick = () => resolvePromotion(true);
    document.getElementById('btn-promote-no').onclick = () => resolvePromotion(false);
};

// --- 通信関連 ---
const PREFIX = 'shogi_v3_'; // バージョン変えて混線を防ぐ

function log(msg) {
    document.getElementById('msg-log').innerText = msg;
}

function startHosting() {
    const val = document.getElementById('room-id').value;
    if (val.length !== 4) return log('4桁のIDを入力してください');
    setupPeer(PREFIX + val, true);
}

function joinGame() {
    const val = document.getElementById('room-id').value;
    if (val.length !== 4) return log('4桁のIDを入力してください');
    setupPeer(null, false, PREFIX + val);
}

function setupPeer(id, isHost, targetId = null) {
    if (peer) peer.destroy();
    peer = id ? new Peer(id) : new Peer();

    log(isHost ? '部屋を作成中...' : '接続中...');

    peer.on('open', (myId) => {
        if (isHost) {
            log('待機中... ID: ' + myId.replace(PREFIX, ''));
            disableInputs();
        } else {
            conn = peer.connect(targetId);
            setupConnection(false);
        }
    });

    peer.on('connection', (connection) => {
        if (isHost) {
            conn = connection;
            setupConnection(true);
        }
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') log('そのIDは使用されています');
        else log('エラー: ' + err.type);
        enableInputs();
    });
}

function setupConnection(isHost) {
    conn.on('open', () => {
        if (isHost) {
            // ホストが先手後手をランダムに決定
            const r = Math.random();
            const hostColor = r < 0.5 ? 'black' : 'white';
            myColor = hostColor;
            
            // 相手に色を通知してゲーム開始
            conn.send({ type: 'init', color: hostColor === 'black' ? 'white' : 'black' });
            log('対局開始！ あなたは' + (myColor==='black'?'先手':'後手') + 'です');
            startGame();
        }
    });

    conn.on('data', (data) => {
        if (data.type === 'init') {
            // ゲスト側：色を受け取って開始
            myColor = data.color;
            log('対局開始！ あなたは' + (myColor==='black'?'先手':'後手') + 'です');
            startGame();
        } else {
            handleRemoteData(data);
        }
    });

    conn.on('close', () => {
        alert('接続が切れました');
        resetGame();
    });
}

function sendData(data) {
    if (conn && conn.open) conn.send(data);
}

function disableInputs() {
    document.getElementById('room-id').disabled = true;
    document.querySelectorAll('.btn').forEach(b => b.disabled = true);
}
function enableInputs() {
    document.getElementById('room-id').disabled = false;
    document.querySelectorAll('.btn').forEach(b => b.disabled = false);
}

// --- ゲーム進行 ---

function startGame() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    initBoard();
    updateHeader();
}

function resetGame() {
    location.reload();
}

function initBoard() {
    boardState = Array(9).fill(null).map(() => Array(9).fill(null));
    hands = { black: {}, white: {} };
    Object.keys(pieceDefs).forEach(k => {
        hands.black[k] = 0;
        hands.white[k] = 0;
    });

    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            const c = initialPlacement[y][x];
            if (c !== ' ') {
                const owner = y <= 2 ? 'white' : 'black';
                boardState[y][x] = { type: c, owner: owner, promoted: false };
            }
        }
    }
    render();
}

function updateHeader() {
    const pInfo = document.getElementById('player-info');
    const role = myColor === 'black' ? '先手(▲)' : '後手(△)';
    pInfo.innerText = `あなたは ${role}`;
    updateStatus();
}

function updateStatus() {
    const el = document.getElementById('turn-indicator');
    const isMyTurn = currentTurn === myColor;
    el.innerText = isMyTurn ? 'あなたの番' : '相手の番';
    el.className = 'turn-badge ' + (isMyTurn ? 'my-turn' : '');
}

// --- 描画 ---

function render() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';
    
    // 自分が後手なら盤面を回転
    if (myColor === 'white') boardEl.classList.add('board-rotated');
    else boardEl.classList.remove('board-rotated');

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

            cell.onclick = () => onCellClick(x, y);

            const p = boardState[y][x];
            if (p) {
                const div = document.createElement('div');
                div.className = `piece ${p.owner} ${p.promoted ? 'promoted' : ''}`;
                
                const def = pieceDefs[p.type];
                let txt = p.promoted ? def.pro : def.name;
                // 王の表示分け: 先手は「玉」、後手は「王」
                if (p.type === 'K' && !p.promoted) {
                    txt = p.owner === 'black' ? '玉' : '王';
                }
                div.innerText = txt;
                
                cell.appendChild(div);
            }
            boardEl.appendChild(cell);
        }
    }
    
    // 持ち駒描画: 自分用と相手用
    const selfHandId = myColor === 'black' ? 'komadai-black' : 'komadai-white'; // UI上ではない。論理ID
    // HTML上のIDは固定だが、中身を出し分ける
    renderHand('komadai-self', myColor);
    renderHand('komadai-opponent', myColor === 'black' ? 'white' : 'black');
}

function renderHand(elementId, color) {
    const container = document.getElementById(elementId);
    container.innerHTML = '';
    
    // 相手の駒台の場合は操作不可にするためクラスを分ける等の工夫も可だが、
    // onHandClickでガードしているのでここでは表示のみ
    const isMine = (color === myColor);

    Object.keys(hands[color]).forEach(type => {
        const count = hands[color][type];
        if (count > 0) {
            const div = document.createElement('div');
            div.className = `hand-piece piece ${color}`;
            // 持ち駒も回転考慮（相手の持ち駒は逆さまに見えるように）
            if (myColor === 'white' && color === 'black') div.style.transform = 'rotate(180deg)';
            if (myColor === 'black' && color === 'white') div.style.transform = 'rotate(180deg)';
            
            // 選択ハイライト
            if (isMine && selectedCell && selectedCell.isHand && selectedCell.type === type) {
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

            if (isMine) {
                div.onclick = (e) => {
                    e.stopPropagation();
                    onHandClick(type);
                };
            }
            container.appendChild(div);
        }
    });
}

// --- 操作ロジック ---

function onHandClick(type) {
    if (myColor !== currentTurn) return;
    
    if (selectedCell && selectedCell.isHand && selectedCell.type === type) {
        selectedCell = null;
    } else {
        selectedCell = { isHand: true, type, color: myColor };
    }
    render();
}

function onCellClick(x, y) {
    if (myColor !== currentTurn) return;

    const target = boardState[y][x];

    // 1. 持ち駒を選択中 -> 打つ
    if (selectedCell && selectedCell.isHand) {
        if (!target) tryDrop(selectedCell.type, x, y);
        return;
    }

    // 2. 盤上の駒を選択中 -> 移動
    if (selectedCell && !selectedCell.isHand) {
        if (selectedCell.x === x && selectedCell.y === y) {
            selectedCell = null;
            render();
            return;
        }
        if (target && target.owner === myColor) {
            selectedCell = { x, y };
            render();
            return;
        }
        tryMove(selectedCell.x, selectedCell.y, x, y);
        return;
    }

    // 3. 未選択 -> 選択
    if (target && target.owner === myColor) {
        selectedCell = { x, y };
        render();
    }
}

function tryMove(fx, fy, tx, ty) {
    const p = boardState[fy][fx];
    if (!canMove(p, fx, fy, tx, ty, boardState)) return;

    const def = pieceDefs[p.type];
    const isPromotable = def.canPro && !p.promoted;
    
    const isBlack = p.owner === 'black';
    const enterZone = isBlack ? ty <= 2 : ty >= 6;
    const leaveZone = isBlack ? fy <= 2 : fy >= 6;
    
    if (isPromotable && (enterZone || leaveZone)) {
        // 強制成りの判定（行き所のない駒）
        if (isForcePromote(p.type, isBlack, ty)) {
            executeMove(fx, fy, tx, ty, true);
        } else {
            // ダイアログ表示
            pendingMove = { fx, fy, tx, ty };
            document.getElementById('promote-modal').style.display = 'flex';
        }
    } else {
        executeMove(fx, fy, tx, ty, false);
    }
}

function isForcePromote(type, isBlack, y) {
    if (type === 'P' || type === 'L') return isBlack ? y === 0 : y === 8;
    if (type === 'N') return isBlack ? y <= 1 : y >= 7;
    return false;
}

function resolvePromotion(res) {
    document.getElementById('promote-modal').style.display = 'none';
    if (pendingMove) {
        executeMove(pendingMove.fx, pendingMove.fy, pendingMove.tx, pendingMove.ty, res);
        pendingMove = null;
    }
}

function executeMove(fx, fy, tx, ty, promote) {
    const p = boardState[fy][fx];
    const target = boardState[ty][tx];

    if (target) {
        // 相手の駒を取る(成っていても元に戻る)
        hands[myColor][target.type]++;
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
    // 二歩チェック
    if (type === 'P') {
        for (let r = 0; r < 9; r++) {
            const t = boardState[r][x];
            if (t && t.owner === myColor && t.type === 'P' && !t.promoted) {
                alert('二歩は禁止です');
                return;
            }
        }
    }
    // 行き所のない場所への打ち込みチェック
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

function finishTurn(data) {
    selectedCell = null;
    lastMovePos = { toX: data.tx, toY: data.ty };
    render();
    
    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    updateStatus();
    sendData(data);
}

function handleRemoteData(data) {
    if (data.type === 'move') {
        const { fx, fy, tx, ty, promote } = data;
        const p = boardState[fy][fx];
        const target = boardState[ty][tx];
        
        // 相手が駒を取った
        if (target) hands[currentTurn][target.type]++;
        
        boardState[ty][tx] = {
            type: p.type,
            owner: p.owner,
            promoted: p.promoted || promote
        };
        boardState[fy][fx] = null;
    } 
    else if (data.type === 'drop') {
        const { piece, tx, ty } = data;
        boardState[ty][tx] = { type: piece, owner: currentTurn, promoted: false };
        hands[currentTurn][piece]--;
    }

    lastMovePos = { toX: data.tx, toY: data.ty };
    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    render();
    updateStatus();
}

// --- 移動判定 ---
function canMove(p, fx, fy, tx, ty, board) {
    const dx = tx - fx;
    const dy = ty - fy;
    const isBlack = p.owner === 'black';
    const target = board[ty][tx];

    if (target && target.owner === p.owner) return false;

    // 定義(黒視点)に合わせるための変換
    const checkDy = isBlack ? dy : -dy; 
    const checkDx = dx; 

    // 金の動き
    const goldMoves = [[-1,-1], [0,-1], [1,-1], [-1,0], [1,0], [0,1]];
    
    // 成り駒(王飛角以外)
    if (p.promoted && ['P','L','N','S'].includes(p.type)) {
        return goldMoves.some(m => m[0] === checkDx && m[1] === checkDy);
    }

    switch (p.type) {
        case 'P': return checkDx === 0 && checkDy === -1;
        case 'L': 
            if (checkDx !== 0) return false;
            if (checkDy >= 0) return false;
            const dist = Math.abs(dy);
            const step = dy > 0 ? 1 : -1;
            for (let i = 1; i < dist; i++) {
                if (board[fy + i * step][fx]) return false;
            }
            return true;
        case 'N': return Math.abs(checkDx) === 1 && checkDy === -2;
        case 'S': 
            const sMoves = [[-1,-1], [0,-1], [1,-1], [-1,1], [1,1]];
            return sMoves.some(m => m[0] === checkDx && m[1] === checkDy);
        case 'G': return goldMoves.some(m => m[0] === checkDx && m[1] === checkDy);
        case 'K': return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
        case 'R':
        case 'B': return checkSliding(p.type, p.promoted, fx, fy, tx, ty, board);
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
    // 王将の動き（周囲1マス）
    const isKingMove = (adx <= 1 && ady <= 1);

    // 飛車・龍
    if (type === 'R') {
        if (isOrtho) {
            if (!checkPath(fx, fy, tx, ty, board)) return false;
            return true;
        }
        // 龍なら斜め1マスOK
        if (isPromoted && isKingMove) return true;
        return false;
    }
    
    // 角・馬
    if (type === 'B') {
        if (isDiag) {
            if (!checkPath(fx, fy, tx, ty, board)) return false;
            return true;
        }
        // 馬なら縦横1マスOK
        if (isPromoted && isKingMove) return true;
        return false;
    }
    return false;
}

// 駒の間の障害物チェック
function checkPath(fx, fy, tx, ty, board) {
    const dx = tx - fx;
    const dy = ty - fy;
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
