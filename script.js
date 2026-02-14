let peer = null;
let conn = null;
let myColor = null; // 'black' (host) or 'white' (guest)
let currentTurn = 'black'; 
let boardState = [];
let hands = { black: {}, white: {} };
let selectedCell = null;
let pendingMove = null;
let lastMovePos = null; // 直前の指し手をハイライト

// 駒定義
const pieceDefinitions = {
    'P': { name: '歩', promotedName: 'と', canPromote: true },
    'L': { name: '香', promotedName: '杏', canPromote: true },
    'N': { name: '桂', promotedName: '圭', canPromote: true },
    'S': { name: '銀', promotedName: '全', canPromote: true },
    'G': { name: '金', promotedName: null, canPromote: false },
    'B': { name: '角', promotedName: '馬', canPromote: true },
    'R': { name: '飛', promotedName: '龍', canPromote: true },
    'K': { name: '王', promotedName: null, canPromote: false }
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

// --- 通信関連 (PeerJS) ---

const PREFIX = 'shogi-dojo-v1-'; // ID重複防止用のプレフィックス

function getPeerId(code) {
    return PREFIX + code;
}

function log(msg) {
    document.getElementById('msg-log').innerText = msg;
}

// 部屋を作る（ホスト：先手）
function startHosting() {
    const code = document.getElementById('room-id').value;
    if (code.length !== 4) return log('4桁のIDを入力してください');

    log('部屋を作成中...');
    
    // ホストとして自分のIDを指定してPeer作成
    peer = new Peer(getPeerId(code));

    peer.on('open', (id) => {
        log(`部屋を作成しました (ID: ${code})\n相手の参加を待っています...`);
        myColor = 'black'; // ホストは先手
        document.getElementById('room-id').disabled = true;
        document.querySelectorAll('button').forEach(b => b.disabled = true);
    });

    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
        log('相手が参加しました！対局開始！');
        startGameUI();
    });

    peer.on('error', (err) => {
        if(err.type === 'unavailable-id') {
            log('そのIDは既に使用されています。別のIDにしてください。');
        } else {
            log('エラーが発生しました: ' + err.type);
        }
        resetButtons();
    });
}

// 参加する（ゲスト：後手）
function joinGame() {
    const code = document.getElementById('room-id').value;
    if (code.length !== 4) return log('4桁のIDを入力してください');

    log('接続中...');
    
    // ゲストはID指定なし（ランダムID）
    peer = new Peer();

    peer.on('open', (id) => {
        // ホストへ接続
        conn = peer.connect(getPeerId(code));
        
        conn.on('open', () => {
            myColor = 'white'; // ゲストは後手
            setupConnection();
            log('接続成功！対局開始！');
            startGameUI();
        });

        // 接続失敗ハンドリング（タイムアウト等）
        setTimeout(() => {
            if (!conn.open) {
                log('接続できませんでした。IDが正しいか確認してください。');
                resetButtons();
            }
        }, 3000);
    });

    peer.on('error', (err) => {
        log('接続エラー: ' + err.type);
        resetButtons();
    });
}

function resetButtons() {
    document.getElementById('room-id').disabled = false;
    document.querySelectorAll('button').forEach(b => b.disabled = false);
}

function setupConnection() {
    // データ受信時の処理
    conn.on('data', (data) => {
        handleRemoteMove(data);
    });
    
    conn.on('close', () => {
        alert('相手との接続が切れました');
        location.reload();
    });
}

function sendMove(data) {
    if (conn && conn.open) {
        conn.send(data);
    }
}

// --- ゲームロジック ---

function startGameUI() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    initBoard();
}

function initBoard() {
    boardState = Array(9).fill(null).map(() => Array(9).fill(null));
    hands = { black: {}, white: {} };
    // 持ち駒初期化
    Object.keys(pieceDefinitions).forEach(k => {
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
    renderBoard();
    updateStatus();
}

function renderBoard() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';

    // 後手なら盤面回転
    if (myColor === 'white') {
        boardEl.classList.add('board-rotated');
    }

    for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 9; x++) {
            const cellDiv = document.createElement('div');
            cellDiv.className = 'cell';
            cellDiv.onclick = () => handleCellClick(x, y);

            // 背景ハイライト
            if (selectedCell && !selectedCell.isHand && selectedCell.x === x && selectedCell.y === y) {
                cellDiv.classList.add('selected');
            }
            if (lastMovePos && lastMovePos.toX === x && lastMovePos.toY === y) {
                cellDiv.classList.add('last-move');
            }

            const piece = boardState[y][x];
            if (piece) {
                const pieceDiv = document.createElement('div');
                const def = pieceDefinitions[piece.type];
                pieceDiv.innerText = piece.promoted ? def.promotedName : def.name;
                pieceDiv.className = `piece ${piece.owner}`;
                if (piece.promoted) pieceDiv.classList.add('promoted');
                cellDiv.appendChild(pieceDiv);
            }
            boardEl.appendChild(cellDiv);
        }
    }
    renderHands();
}

function renderHands() {
    ['black', 'white'].forEach(color => {
        const container = document.getElementById(`komadai-${color}`);
        container.innerHTML = '';
        const hand = hands[color];
        
        Object.keys(hand).forEach(type => {
            if (hand[type] > 0) {
                const wrapper = document.createElement('div');
                wrapper.className = 'cell';
                wrapper.style.border = 'none'; // 駒台用のスタイル調整
                wrapper.style.width = '35px';
                wrapper.style.height = '35px';

                const pieceDiv = document.createElement('div');
                pieceDiv.className = `piece ${color}`;
                pieceDiv.innerText = pieceDefinitions[type].name;
                // 枚数表示
                if (hand[type] > 1) {
                    const count = document.createElement('span');
                    count.innerText = hand[type];
                    count.style.fontSize = '10px';
                    count.style.position = 'absolute';
                    count.style.bottom = '0';
                    count.style.right = '0';
                    pieceDiv.appendChild(count);
                }

                wrapper.onclick = () => {
                    if (myColor !== color) return;
                    if (currentTurn !== myColor) return;
                    selectedCell = { isHand: true, type: type, color: color };
                    renderBoard();
                    // 選択状態の視覚化
                    wrapper.style.backgroundColor = 'rgba(255, 235, 59, 0.6)';
                };
                wrapper.appendChild(pieceDiv);
                container.appendChild(wrapper);
            }
        });
    });
}

function handleCellClick(x, y) {
    if (myColor !== currentTurn) return;

    const clickedPiece = boardState[y][x];

    // 1. 持ち駒選択中 -> 打つ
    if (selectedCell && selectedCell.isHand) {
        if (!clickedPiece) {
            tryDropPiece(selectedCell.type, x, y);
        } else {
            // 自分の駒なら選択し直し
            if (clickedPiece.owner === myColor) {
                selectedCell = { x, y };
                renderBoard();
            }
        }
        return;
    }

    // 2. 盤上の駒を選択中
    if (selectedCell && !selectedCell.isHand) {
        const fromX = selectedCell.x;
        const fromY = selectedCell.y;

        // 同じ場所 -> キャンセル
        if (x === fromX && y === fromY) {
            selectedCell = null;
            renderBoard();
            return;
        }

        // 自分の駒 -> 選択変更
        if (clickedPiece && clickedPiece.owner === myColor) {
            selectedCell = { x, y };
            renderBoard();
            return;
        }

        // 移動または取る
        tryMovePiece(fromX, fromY, x, y);
        return;
    }

    // 3. 未選択 -> 選択
    if (clickedPiece && clickedPiece.owner === myColor) {
        selectedCell = { x, y };
        renderBoard();
    }
}

function tryMovePiece(fromX, fromY, toX, toY) {
    const piece = boardState[fromY][fromX];
    if (!isValidMove(piece, fromX, fromY, toX, toY, boardState)) return;

    const isPromotable = pieceDefinitions[piece.type].canPromote && !piece.promoted;
    const isEnterZone = (piece.owner === 'black' && toY <= 2) || (piece.owner === 'white' && toY >= 6);
    const isLeaveZone = (piece.owner === 'black' && fromY <= 2) || (piece.owner === 'white' && fromY >= 6);

    // 強制成り判定 (歩・香は行き所がなくなったら強制)
    // 簡易実装として、1段目(歩香)・2段目(桂)チェックを入れるのが理想だが、
    // ここでは「ユーザー選択」を基本としつつ、ルール上必須な場面だけ自動にする実装は複雑になるため
    // ゾーンに入ったらダイアログを出す形式にする。

    if (isPromotable && (isEnterZone || isLeaveZone)) {
        // 例外：歩と香車が最奥、桂馬が奥2段に行った場合は強制成りなどのルールがあるが、
        // 簡易化のため全て選択ダイアログとする（ただし、行き所のない場所へ打つのは禁止済み）
        pendingMove = { fromX, fromY, toX, toY };
        document.getElementById('promote-modal').style.display = 'flex';
    } else {
        executeMove(fromX, fromY, toX, toY, false);
    }
}

function resolvePromotion(shouldPromote) {
    document.getElementById('promote-modal').style.display = 'none';
    if (pendingMove) {
        executeMove(pendingMove.fromX, pendingMove.fromY, pendingMove.toX, pendingMove.toY, shouldPromote);
        pendingMove = null;
    }
}

function executeMove(fromX, fromY, toX, toY, promote) {
    const piece = boardState[fromY][fromX];
    const target = boardState[toY][toX];
    let captured = null;

    if (target) {
        captured = target.type;
        hands[myColor][captured] = (hands[myColor][captured] || 0) + 1;
    }

    boardState[toY][toX] = {
        type: piece.type,
        owner: piece.owner,
        promoted: piece.promoted || promote
    };
    boardState[fromY][fromX] = null;
    selectedCell = null;
    lastMovePos = { toX, toY };

    renderBoard();
    switchTurn();

    // 相手に送信
    sendMove({
        type: 'move',
        fromX, fromY, toX, toY, promote
    });
}

function tryDropPiece(type, x, y) {
    // 二歩チェック
    if (type === 'P') {
        for (let row = 0; row < 9; row++) {
            const p = boardState[row][x];
            if (p && p.owner === myColor && p.type === 'P' && !p.promoted) {
                alert("二歩です");
                return;
            }
        }
        // 行き所のない歩
        if ((myColor === 'black' && y === 0) || (myColor === 'white' && y === 8)) return;
    }
    // 香・桂の行き所なしチェックは省略（プレイヤーの良心に任せる）

    boardState[y][x] = { type: type, owner: myColor, promoted: false };
    hands[myColor][type]--;
    selectedCell = null;
    lastMovePos = { toX: x, toY: y };

    renderBoard();
    switchTurn();

    sendMove({
        type: 'drop',
        pieceType: type,
        toX: x, toY: y
    });
}

function handleRemoteMove(data) {
    if (data.type === 'move') {
        const { fromX, fromY, toX, toY, promote } = data;
        const piece = boardState[fromY][fromX];
        const target = boardState[toY][toX];

        if (target) {
            // 相手が取った = 相手の持ち駒になる
            hands[currentTurn][target.type] = (hands[currentTurn][target.type] || 0) + 1;
        }

        boardState[toY][toX] = {
            type: piece.type,
            owner: piece.owner,
            promoted: piece.promoted || promote
        };
        boardState[fromY][fromX] = null;
        lastMovePos = { toX, toY };

    } else if (data.type === 'drop') {
        const { pieceType, toX, toY } = data;
        boardState[toY][toX] = { type: pieceType, owner: currentTurn, promoted: false };
        hands[currentTurn][pieceType]--;
        lastMovePos = { toX, toY };
    }

    renderBoard();
    switchTurn();
}

function switchTurn() {
    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    updateStatus();
}

function updateStatus() {
    const el = document.getElementById('status-display');
    const isMyTurn = currentTurn === myColor;
    const turnText = currentTurn === 'black' ? '先手' : '後手';
    
    if (isMyTurn) {
        el.innerText = `[${turnText}] あなたの番です`;
        el.style.color = '#d32f2f';
    } else {
        el.innerText = `[${turnText}] 相手の番です`;
        el.style.color = '#333';
    }
}

// --- 移動判定ロジック (前と同じ) ---
function isValidMove(piece, fx, fy, tx, ty, board) {
    const dx = tx - fx;
    const dy = ty - fy;
    const isBlack = piece.owner === 'black';
    const target = board[ty][tx];

    if (target && target.owner === piece.owner) return false;

    // 定義座標は「黒番」視点。白番はdyを反転してチェック
    const checkDy = isBlack ? dy : -dy; 
    const checkDx = dx; 

    const goldMoves = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[0,1]];
    let moves = [];

    // 成り駒の動き
    if (piece.promoted && ['P','L','N','S'].includes(piece.type)) {
        return goldMoves.some(m => m[0] === checkDx && m[1] === checkDy);
    }

    switch (piece.type) {
        case 'P': moves = [[0,-1]]; break;
        case 'L': 
            if (checkDx !== 0) return false;
            if (checkDy >= 0) return false; // 後ろには下がれない
            // 間の障害物
            const dist = Math.abs(dy);
            const stepY = dy > 0 ? 1 : -1;
            for(let i=1; i<dist; i++) {
                if(board[fy + i*stepY][fx]) return false;
            }
            return true;
        case 'N': moves = [[-1,-2], [1,-2]]; break;
        case 'S': moves = [[-1,-1],[0,-1],[1,-1],[-1,1],[1,1]]; break;
        case 'G': moves = goldMoves; break;
        case 'K': moves = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]; break;
        case 'B':
        case 'R':
            return checkSliding(piece.type, piece.promoted, fx, fy, tx, ty, board);
    }

    return moves.some(m => m[0] === checkDx && m[1] === checkDy);
}

function checkSliding(type, promoted, fx, fy, tx, ty, board) {
    const dx = tx - fx;
    const dy = ty - fy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (type === 'R') { // 飛車
        const isOrthogonal = (dx === 0 || dy === 0);
        const isKingMove = (adx <= 1 && ady <= 1);
        if (!isOrthogonal && !(promoted && isKingMove)) return false;
        
        if (isOrthogonal) {
            const sx = Math.sign(dx);
            const sy = Math.sign(dy);
            let cx = fx + sx, cy = fy + sy;
            while(cx !== tx || cy !== ty) {
                if(board[cy][cx]) return false;
                cx += sx; cy += sy;
            }
        }
        return true;
    }
    if (type === 'B') { // 角
        const isDiagonal = (adx === ady);
        const isKingMove = (adx <= 1 && ady <= 1);
        if (!isDiagonal && !(promoted && isKingMove)) return false;

        if (isDiagonal) {
            const sx = Math.sign(dx);
            const sy = Math.sign(dy);
            let cx = fx + sx, cy = fy + sy;
            while(cx !== tx || cy !== ty) {
                if(board[cy][cx]) return false;
                cx += sx; cy += sy;
            }
        }
        return true;
    }
    return false;
}
