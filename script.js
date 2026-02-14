// --- グローバル変数 ---
let peer = null;
let conn = null;
let myColor = null;       // 'black' or 'white'
let currentTurn = 'black';
let boardState = [];
let hands = { black: {}, white: {} };
let selectedCell = null;  // {x,y} または {isHand, type, color}
let pendingMove = null;
let lastMovePos = null;
let gameActive = false;

// --- 駒定義 ---
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
    document.getElementById('btn-promote-yes').onclick = () => resolvePromotion(true);
    document.getElementById('btn-promote-no').onclick = () => resolvePromotion(false);
};

// --- 通信 (PeerJS) ---
const PREFIX = 'shogi_v4_'; 

function log(msg) { document.getElementById('msg-log').innerText = msg; }

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

    log(isHost ? '部屋作成中...' : '接続中...');

    peer.on('open', (myId) => {
        if (isHost) {
            log('待機中... ID: ' + myId.replace(PREFIX, ''));
            toggleInputs(false);
        } else {
            conn = peer.connect(targetId);
            setupConnection(false);
        }
    });

    peer.on('connection', (c) => {
        if (isHost) {
            conn = c;
            setupConnection(true);
        }
    });

    peer.on('error', (err) => {
        log('エラー: ' + err.type);
        toggleInputs(true);
    });
}

function setupConnection(isHost) {
    conn.on('open', () => {
        if (isHost) {
            const hostColor = Math.random() < 0.5 ? 'black' : 'white';
            myColor = hostColor;
            conn.send({ type: 'init', color: hostColor === 'black' ? 'white' : 'black' });
            startGame();
        }
    });

    conn.on('data', (data) => {
        if (data.type === 'init') {
            myColor = data.color;
            startGame();
        } else if (data.type === 'move') {
            handleRemoteMove(data);
        } else if (data.type === 'drop') {
            handleRemoteDrop(data);
        }
    });

    conn.on('close', () => {
        if(gameActive) alert('切断されました');
        resetGame();
    });
}

function sendData(data) { if (conn && conn.open) conn.send(data); }

function toggleInputs(enable) {
    document.getElementById('room-id').disabled = !enable;
    document.querySelectorAll('.btn').forEach(b => b.disabled = !enable);
}

// --- ゲーム進行 ---
function startGame() {
    gameActive = true;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    document.getElementById('player-info').innerText = `あなたは ${myColor==='black'?'先手(▲)':'後手(△)'}`;
    
    // 盤面初期化
    boardState = Array(9).fill(null).map(() => Array(9).fill(null));
    hands = { black: {}, white: {} };
    Object.keys(pieceDefs).forEach(k => { hands.black[k]=0; hands.white[k]=0; });

    for(let y=0; y<9; y++){
        for(let x=0; x<9; x++){
            const c = initialPlacement[y][x];
            if(c !== ' ') boardState[y][x] = { type: c, owner: y<=2?'white':'black', promoted: false };
        }
    }
    render();
    updateStatus();
}

function resetGame() { location.reload(); }

function updateStatus() {
    const el = document.getElementById('turn-indicator');
    const isMyTurn = currentTurn === myColor;
    el.innerText = isMyTurn ? 'あなたの番' : '相手の番';
    el.className = 'turn-badge ' + (isMyTurn ? 'my-turn' : '');
}

// --- 描画ロジック ---
function render() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';
    
    // 後手なら盤面回転
    if(myColor === 'white') boardEl.classList.add('board-rotated');

    // 移動可能マスを計算（選択中の場合）
    let validMoves = [];
    if (selectedCell && gameActive && currentTurn === myColor) {
        if (selectedCell.isHand) {
            // 持ち駒の打ち場所計算
            validMoves = getValidDrops(selectedCell.type);
        } else {
            // 盤上の駒の移動場所計算
            validMoves = getValidMoves(selectedCell.x, selectedCell.y);
        }
    }

    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            
            // 座標データを持たせる
            cell.dataset.x = x;
            cell.dataset.y = y;

            // ハイライト処理
            if (selectedCell && !selectedCell.isHand && selectedCell.x === x && selectedCell.y === y) {
                cell.classList.add('selected');
            }
            if (lastMovePos && lastMovePos.toX === x && lastMovePos.toY === y) {
                cell.classList.add('last-move');
            }
            
            // ガイド表示
            const isValid = validMoves.some(m => m.x === x && m.y === y);
            if (isValid) {
                if (selectedCell.isHand) cell.classList.add('valid-drop');
                else cell.classList.add('valid-move');
            }

            cell.onclick = () => onCellClick(x, y);

            const p = boardState[y][x];
            if (p) {
                const div = document.createElement('div');
                div.className = `piece ${p.owner} ${p.promoted?'promoted':''}`;
                let txt = p.promoted ? pieceDefs[p.type].pro : pieceDefs[p.type].name;
                // 玉と王の出し分け
                if(p.type === 'K' && !p.promoted) txt = p.owner==='black' ? '玉' : '王';
                div.innerText = txt;
                cell.appendChild(div);
            }
            boardEl.appendChild(cell);
        }
    }
    renderHand('komadai-self', myColor);
    renderHand('komadai-opponent', myColor==='black'?'white':'black');
}

function renderHand(id, color) {
    const container = document.getElementById(id);
    container.innerHTML = '';
    const isMine = (color === myColor);

    Object.keys(hands[color]).forEach(type => {
        const count = hands[color][type];
        if (count > 0) {
            const div = document.createElement('div');
            div.className = `hand-piece piece ${color}`;
            if(myColor === 'white' && color === 'black') div.style.transform = 'rotate(180deg)';
            if(myColor === 'black' && color === 'white') div.style.transform = 'rotate(180deg)';

            if (isMine && selectedCell && selectedCell.isHand && selectedCell.type === type) {
                div.classList.add('selected');
            }

            div.innerText = pieceDefs[type].name;
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

// --- 入力ハンドラ ---
function onHandClick(type) {
    if (!gameActive || myColor !== currentTurn) return;
    if (selectedCell && selectedCell.isHand && selectedCell.type === type) {
        selectedCell = null;
    } else {
        selectedCell = { isHand: true, type, color: myColor };
    }
    render();
}

function onCellClick(x, y) {
    if (!gameActive || myColor !== currentTurn) return;

    const target = boardState[y][x];

    // 1. 持ち駒選択中 -> 打つ
    if (selectedCell && selectedCell.isHand) {
        if (!target) {
            // 打てるかチェック
            const drops = getValidDrops(selectedCell.type);
            if (drops.some(d => d.x === x && d.y === y)) {
                executeDrop(selectedCell.type, x, y);
            }
        }
        return;
    }

    // 2. 盤上の駒を選択中 -> 移動
    if (selectedCell && !selectedCell.isHand) {
        if (selectedCell.x === x && selectedCell.y === y) {
            selectedCell = null; render(); return;
        }
        if (target && target.owner === myColor) {
            selectedCell = { x, y }; render(); return;
        }
        
        // 移動可能かチェック
        const moves = getValidMoves(selectedCell.x, selectedCell.y);
        if (moves.some(m => m.x === x && m.y === y)) {
            tryMove(selectedCell.x, selectedCell.y, x, y);
        }
        return;
    }

    // 3. 未選択 -> 選択
    if (target && target.owner === myColor) {
        selectedCell = { x, y };
        render();
    }
}

// --- ロジック計算 (重要) ---

// 指定した駒が移動できる座標リストを返す
function getValidMoves(fx, fy) {
    const p = boardState[fy][fx];
    if (!p) return [];

    const moves = [];
    const isBlack = p.owner === 'black';
    const forward = isBlack ? -1 : 1; // Y軸の進行方向

    // 方向定義 (dx, dy) ※黒番視点
    const goldDirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[0,1]];
    const silverDirs = [[-1,-1],[0,-1],[1,-1],[-1,1],[1,1]];
    const knightDirs = [[-1,-2],[1,-2]];

    // 成り駒の動き変換
    let type = p.type;
    if (p.promoted) {
        if (['P','L','N','S'].includes(type)) type = 'G'; // 金と同じ
    }

    // 1歩動く系
    let checkDirs = [];
    if (type === 'P') checkDirs = [[0,-1]];
    else if (type === 'S') checkDirs = silverDirs;
    else if (type === 'G') checkDirs = goldDirs;
    else if (type === 'K') checkDirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

    checkDirs.forEach(d => {
        const tx = fx + d[0];
        const ty = fy + (d[1] * (isBlack ? 1 : -1)); // 白なら上下反転
        if (onBoard(tx, ty) && !isFriend(tx, ty, p.owner)) {
            moves.push({x: tx, y: ty});
        }
    });

    // 桂馬
    if (type === 'N') {
        knightDirs.forEach(d => {
            const tx = fx + d[0];
            const ty = fy + (d[1] * (isBlack ? 1 : -1));
            if (onBoard(tx, ty) && !isFriend(tx, ty, p.owner)) {
                moves.push({x: tx, y: ty});
            }
        });
    }

    // 走り駒 (香, 飛, 角, 龍, 馬)
    if (['L', 'R', 'B'].includes(type) || (p.promoted && ['R','B'].includes(p.type))) {
        const slideDirs = [];
        if (type === 'L') slideDirs.push([0, -1]);
        if (type === 'R') slideDirs.push([0,-1],[0,1],[-1,0],[1,0]);
        if (type === 'B') slideDirs.push([-1,-1],[1,-1],[-1,1],[1,1]);

        slideDirs.forEach(d => {
            let tx = fx;
            let ty = fy;
            const dx = d[0];
            const dy = d[1] * (isBlack ? 1 : -1);

            while(true) {
                tx += dx;
                ty += dy;
                if (!onBoard(tx, ty)) break;
                if (isFriend(tx, ty, p.owner)) break;
                
                moves.push({x: tx, y: ty});
                
                if (boardState[ty][tx] !== null) break; // 敵駒なら取って止まる
            }
        });
    }

    // 龍・馬の追加1マス移動
    if (p.promoted) {
        let kingMoves = [];
        if (p.type === 'R') kingMoves = [[-1,-1],[1,-1],[-1,1],[1,1]]; // 斜め
        if (p.type === 'B') kingMoves = [[0,-1],[0,1],[-1,0],[1,0]];   // 縦横

        kingMoves.forEach(d => {
            const tx = fx + d[0];
            const ty = fy + (d[1] * (isBlack ? 1 : -1));
            if (onBoard(tx, ty) && !isFriend(tx, ty, p.owner)) {
                // 重複追加を防ぐ
                if (!moves.some(m => m.x === tx && m.y === ty)) {
                    moves.push({x: tx, y: ty});
                }
            }
        });
    }

    return moves;
}

// 持ち駒が打てる場所を計算
function getValidDrops(type) {
    const drops = [];
    const isBlack = myColor === 'black';

    for(let y=0; y<9; y++){
        for(let x=0; x<9; x++){
            if(boardState[y][x]) continue; // 既に駒がある

            // 禁止手チェック
            // 1. 二歩
            if(type === 'P' && isNifu(x, myColor)) continue;
            
            // 2. 行き所のない駒
            if(type === 'P' || type === 'L') {
                if((isBlack && y===0) || (!isBlack && y===8)) continue;
            }
            if(type === 'N') {
                if((isBlack && y<=1) || (!isBlack && y>=7)) continue;
            }

            drops.push({x, y});
        }
    }
    return drops;
}

function onBoard(x, y) { return x>=0 && x<9 && y>=0 && y<9; }
function isFriend(x, y, color) { return boardState[y][x] && boardState[y][x].owner === color; }
function isNifu(x, color) {
    for(let y=0; y<9; y++){
        const p = boardState[y][x];
        if(p && p.owner === color && p.type === 'P' && !p.promoted) return true;
    }
    return false;
}

// --- アクション実行 ---
function tryMove(fx, fy, tx, ty) {
    const p = boardState[fy][fx];
    const isBlack = p.owner === 'black';
    const isPromotable = pieceDefs[p.type].canPro && !p.promoted;
    
    // ゾーン判定
    const enter = isBlack ? ty <= 2 : ty >= 6;
    const leave = isBlack ? fy <= 2 : fy >= 6;
    
    // 強制成りチェック
    let force = false;
    if(p.type === 'P' || p.type === 'L') force = (isBlack && ty===0) || (!isBlack && ty===8);
    if(p.type === 'N') force = (isBlack && ty<=1) || (!isBlack && ty>=7);

    if (force) {
        executeMove(fx, fy, tx, ty, true);
    } else if (isPromotable && (enter || leave)) {
        pendingMove = { fx, fy, tx, ty };
        document.getElementById('promote-modal').style.display = 'flex';
    } else {
        executeMove(fx, fy, tx, ty, false);
    }
}

function resolvePromotion(yes) {
    document.getElementById('promote-modal').style.display = 'none';
    if(pendingMove) {
        executeMove(pendingMove.fx, pendingMove.fy, pendingMove.tx, pendingMove.ty, yes);
        pendingMove = null;
    }
}

function executeMove(fx, fy, tx, ty, promote) {
    const p = boardState[fy][fx];
    const target = boardState[ty][tx];
    
    // 王を取ったか判定（勝敗判定）
    if (target && target.type === 'K') {
        endGame(myColor); // 自分が勝った
        // 通信相手には「取られた」事実を送ることで負けを判定させる
    } else {
        if (target) hands[myColor][target.type]++;
    }

    // 盤面更新
    boardState[ty][tx] = { type: p.type, owner: p.owner, promoted: p.promoted || promote };
    boardState[fy][fx] = null;
    
    finishTurn({ type: 'move', fx, fy, tx, ty, promote }, target && target.type === 'K');
}

function executeDrop(type, x, y) {
    boardState[y][x] = { type, owner: myColor, promoted: false };
    hands[myColor][type]--;
    finishTurn({ type: 'drop', piece: type, tx: x, ty: y }, false);
}

function finishTurn(data, isWin) {
    selectedCell = null;
    lastMovePos = { toX: data.tx, toY: data.ty };
    render();

    if (isWin) {
        // 自分が勝った場合、ここで処理終了（モーダルはendGameで出てる）
        sendData(data); // 最後の動きを送信
        return;
    }

    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    updateStatus();
    sendData(data);
}

function handleRemoteMove(data) {
    const { fx, fy, tx, ty, promote } = data;
    const p = boardState[fy][fx];
    const target = boardState[ty][tx];

    // 王が取られたかチェック
    if (target && target.type === 'K') {
        // 相手のmoveで自分の王が消える -> 自分の負け
        boardState[ty][tx] = { type: p.type, owner: p.owner, promoted: p.promoted || promote };
        boardState[fy][fx] = null;
        render();
        endGame(currentTurn); // 相手(currentTurn)の勝ち
        return;
    }

    if (target) hands[currentTurn][target.type]++;
    
    boardState[ty][tx] = { type: p.type, owner: p.owner, promoted: p.promoted || promote };
    boardState[fy][fx] = null;
    
    commonPostMove(data);
}

function handleRemoteDrop(data) {
    const { piece, tx, ty } = data;
    boardState[ty][tx] = { type: piece, owner: currentTurn, promoted: false };
    hands[currentTurn][piece]--;
    commonPostMove(data);
}

function commonPostMove(data) {
    lastMovePos = { toX: data.tx, toY: data.ty };
    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    render();
    updateStatus();
}

function endGame(winnerColor) {
    gameActive = false;
    const modal = document.getElementById('result-modal');
    const msg = document.getElementById('result-message');
    const title = document.getElementById('result-title');
    
    modal.style.display = 'flex';
    if (winnerColor === myColor) {
        title.innerText = "勝利！";
        title.style.color = "#d32f2f";
        msg.innerText = "おめでとうございます。あなたの勝ちです。";
    } else {
        title.innerText = "敗北...";
        title.style.color = "#1976d2";
        msg.innerText = "残念、あなたの負けです。";
    }
}
