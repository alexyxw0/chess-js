var c = document.getElementById('mainCanvas');
var ctx = c.getContext('2d');
ctx.font = '20px Arial';

class Tile {
  constructor(x, y, piece) {
    this.colors = ['#e2cfaf', '#716757', '#b4c989', '#7d8563', '#d9998e', '#b24d4d'];
    this.dotColors = ['#c6b599', '#554d41']
    this.x = x;
    this.y = y;
    if ((x+y)%2 == 1)
      this.color = 1
    else
      this.color = 0;
    this.piece = piece;
    this.img = new Image();
  }

  copy() {
    if (this.piece != null)
      return new this.constructor(this.x, this.y, this.piece.copy());
    return new this.constructor(this.x, this.y, null);
  }

  clear() {
    if (this.color > 3)
      this.color -= 4;
    else if (this.color >= 2)
      this.color -= 2;
    this.draw();
  }

  isHighlighted() {
    return this.color >= 2;
  }

  isAlerted() {
    return this.color >= 4
  }

  setState(newState) {
    this.state = newState;
  }

  draw() {
    ctx.fillStyle = this.colors[this.color];
    ctx.fillRect(100*this.x, 100*this.y, 100, 100);
    if (this.piece != null) {
      this.img.onload = function(){
        ctx.drawImage(this.img, 100*this.x, 100*this.y, 100, 100);
      }.bind(this);
      this.img.src = this.piece.getStr();
    }
  }

  highlight() {
    if (this.color < 2)
      this.color += 2;
    this.draw();
  }

  alert() {
    if (this.color < 2)
      this.color += 4;
    this.draw()
  }


  showMove() {
    ctx.fillStyle = this.dotColors[this.color];
    if (this.piece == null) {
      ctx.beginPath();
      ctx.arc(100*this.x+50, 100*this.y+50, 15, 0, 2*Math.PI);
      ctx.fill();
    }
    else {
      const key = [1, -1];
      for (var i=0; i<=1; i++)
        for (var j=0; j<=1; j++) {
          ctx.beginPath();
          ctx.moveTo(100*(this.x+i), 100*(this.y+j));
          ctx.lineTo(100*(this.x+i)+(30*key[i]), 100*(this.y+j));
          ctx.lineTo(100*(this.x+i), 100*(this.y+j)+(30*key[j]));
          ctx.fill();
        }

    }
  }
}


class Piece {
  constructor(color, master, isPromoted=false) {
    this.color = color;
    this.master = master;
    this.hasMoved = 0;
    this.isPromoted = isPromoted;
  }

  move() {
    this.hasMoved += 1;
    if (this.isPromoted != false)
      this.isPromoted += 1;
  }

  unmove() {
    this.hasMoved -= 1;
    if (this.isPromoted != false)
      this.isPromoted -= 1;
  }

  getTakingMoves(i, j) {
    if (this.constructor.name == 'Pawn')
      return this.getMoves2(i, j);
    return this.getMoves(i, j);
  }

  moves(i, j) {
    var moves = [];
    if (this.constructor.name == 'King') {
      for (var tiles of this.master.checkCastling(this.color)) {
        moves.push(new Castle(tiles[0], tiles[1], tiles[2], tiles[3], this.master));
      }
    }
    if (this.constructor.name == 'Pawn') {
      for (var tiles of this.master.checkEnPassant(this.color)) {
        if (this == tiles[0].piece)
          moves.push(new EnPassant(tiles[0], tiles[1], tiles[2], this.master));
      }
    }
    for (var tile of this.getMoves(i, j)) {
      moves.push(new Move(this.master.board[i][j], tile, this.master));
    }
    return moves;
  }

  copy() {
    return new this.constructor(this.color);
  }

  insertMove(i, j, moves) {
    if (i < 0 || i >= this.master.board.length || j < 0 || j >= this.master.board.length)
      return false;
    if (this.master.board[i][j].piece == null) {
      moves.add(this.master.board[i][j]);
      return true;
    }
    if (this.master.board[i][j].piece.color != this.color)
      moves.add(this.master.board[i][j]);
    return false;
  }
}


class Pawn extends Piece {
  constructor(color, master) {
    super(color, master);
  }

  getMoves2(i, j) {
    var moves = new Set();
    if (this.color == 'black') {
      this.insertMove(i-1, j+1, moves);
      this.insertMove(i-1, j-1, moves);
    }
    else {
      this.insertMove(i+1, j+1, moves);
      this.insertMove(i+1, j-1, moves);
    }
    return moves;
  }

  getMoves(i, j) {
    var moves = new Set();
    if (this.color == 'white') {
      if (i == 1 && this.master.board[i+1][j].piece == null && this.master.board[i+2][j].piece == null)
        moves.add(this.master.board[i+2][j]);
      if (this.master.board[i+1][j].piece == null)
        moves.add(this.master.board[i+1][j]);
      if (j+1 < this.master.board.length && this.master.board[i+1][j+1].piece != null && this.master.board[i+1][j+1].piece.color == 'black')
        moves.add(this.master.board[i+1][j+1]);
      if (j-1 >= 0 && this.master.board[i+1][j-1].piece != null && this.master.board[i+1][j-1].piece.color == 'black')
        moves.add(this.master.board[i+1][j-1]);
    }
    else {
      if (i == 6 && this.master.board[i-1][j].piece == null && this.master.board[i-2][j].piece == null)
        moves.add(this.master.board[i-2][j]);
      if (this.master.board[i-1][j].piece == null)
        moves.add(this.master.board[i-1][j]);
      if (j+1 < this.master.board.length && this.master.board[i-1][j+1].piece != null && this.master.board[i-1][j+1].piece.color == 'white')
        moves.add(this.master.board[i-1][j+1]);
      if (j-1 >= 0 && this.master.board[i-1][j-1].piece != null && this.master.board[i-1][j-1].piece.color == 'white')
        moves.add(this.master.board[i-1][j-1]);
    }
    return moves;
  }

  getStr() {
    if (this.color == 'white')
      return 'chess_pieces/wP.svg';
    else
      return 'chess_pieces/bP.svg';
  }
}


class Queen extends Piece {
  constructor(color, master, isPromoted=false) {
    super(color, master, isPromoted);
  }

  getStr() {
    if (this.color == 'white')
      return 'chess_pieces/wQ.svg';
    else
      return 'chess_pieces/bQ.svg';
  }

  getMoves(i, j) {
    var moves = new Set();
    for (var k=1; i+k<this.master.board.length&&j+k<this.master.board.length;k++)
      if (!this.insertMove(i+k, j+k, moves))
        break;
    for (var k=1; i+k<this.master.board.length&&j-k>=0;k++)
      if (!this.insertMove(i+k, j-k, moves))
        break;
    for (var k=1; i-k>=0&&j+k<this.master.board.length;k++)
      if (!this.insertMove(i-k, j+k, moves))
        break;
    for (var k=1; i-k>=0&&j-k>=0;k++)
      if (!this.insertMove(i-k, j-k, moves))
        break;
    for (var k=i+1; k<this.master.board.length; k++)
      if (!this.insertMove(k, j, moves))
        break;
    for (var k=i-1; k>=0; k--)
      if (!this.insertMove(k, j, moves))
        break;
    for (var k=j+1; k<this.master.board.length; k++)
      if (!this.insertMove(i, k, moves))
        break;
    for (var k=j-1; k>=0; k--)
      if (!this.insertMove(i, k, moves))
        break;
    return moves;
  }
}


class Bishop extends Piece {
  constructor(color, master) {
    super(color, master);
  }

  getStr() {
    if (this.color == 'white')
      return 'chess_pieces/wB.svg';
    else
      return 'chess_pieces/bB.svg';
  }

  getMoves(i, j) {
    var moves = new Set();
    for (var k=1; i+k<this.master.board.length&&j+k<this.master.board.length;k++)
      if (!this.insertMove(i+k, j+k, moves))
        break;
    for (var k=1; i+k<this.master.board.length&&j-k>=0;k++)
      if (!this.insertMove(i+k, j-k, moves))
        break;
    for (var k=1; i-k>=0&&j+k<this.master.board.length;k++)
      if (!this.insertMove(i-k, j+k, moves))
        break;
    for (var k=1; i-k>=0&&j-k>=0;k++)
      if (!this.insertMove(i-k, j-k, moves))
        break;
    return moves;
  }
}


class Rook extends Piece {
  constructor(color, master) {
    super(color, master);
  }

  getStr() {
    if (this.color == 'white')
      return 'chess_pieces/wR.svg';
    else
      return 'chess_pieces/bR.svg';
  }

  getMoves(i, j) {
    var moves = new Set();
    for (var k=i+1; k<this.master.board.length; k++)
      if (!this.insertMove(k, j, moves))
        break;
    for (var k=i-1; k>=0; k--)
      if (!this.insertMove(k, j, moves))
        break;
    for (var k=j+1; k<this.master.board.length; k++)
      if (!this.insertMove(i, k, moves))
        break;
    for (var k=j-1; k>=0; k--)
      if (!this.insertMove(i, k, moves))
        break;
    return moves;
  }
}


class Knight extends Piece {
  constructor(color, master) {
    super(color, master);
  }

  getStr() {
    if (this.color == 'white')
      return 'chess_pieces/wN.svg';
    else
      return 'chess_pieces/bN.svg';
  }

  getMoves(i, j) {
    var moves = new Set();
    this.insertMove(i+2, j+1, moves);
    this.insertMove(i+2, j-1, moves);
    this.insertMove(i+1, j+2, moves);
    this.insertMove(i+1, j-2, moves);
    this.insertMove(i-1, j+2, moves);
    this.insertMove(i-1, j-2, moves);
    this.insertMove(i-2, j+1, moves);
    this.insertMove(i-2, j-1, moves);
    return moves;
  }
}


class King extends Piece {
  constructor(color, master) {
    super(color, master);
  }

  getStr() {
    if (this.color == 'white')
      return 'chess_pieces/wK.svg';
    else
      return 'chess_pieces/bK.svg';
  }

  getMoves(i, j) {
    var moves = new Set();
    for (var y=-1; y<=1; y++)
      for (var x=-1; x<=1; x++)
        this.insertMove(i+y, j+x, moves);
    return moves;
  }
}


class Move {

  constructor(t1, t2, master) {
    this.t1 = t1;
    this.t2 = t2;
    this.lastPiece = this.t2.piece;
    this.master = master;
    this.isCapture = (this.t2.piece != null)
  }

  makeMove(isSimulation) {
    var t1 = this.t1;
    var t2 = this.t2
    var board = this.master;
    if (!isSimulation) {
      t1.piece.move();
    }
    if (t1.piece.color == 'white') {
      board.whitePieces.delete(t1);
      board.whitePieces.add(t2);
      if (t2.piece != null)
        board.blackPieces.delete(t2);
      if (t1.piece.constructor.name == 'King')
        board.whiteKing = t2;
    }
    else {
      board.blackPieces.delete(t1);
      board.blackPieces.add(t2);
      if (t2.piece != null)
        board.whitePieces.delete(t2);
      if (t1.piece.constructor.name == 'King')
        board.blackKing = t2;
    }
    t2.piece = t1.piece;
    t1.piece = null;
    if (!isSimulation) {
      board.checkPromotion();
      t1.draw();
      t2.draw();
    }
  }

  unmakeMove(isSimulation) {
    var t1 = this.t1;
    var t2 = this.t2
    var board = this.master;
    if (t2.piece.color == 'white') {
      board.whitePieces.delete(t2);
      board.whitePieces.add(t1);
      if (this.lastPiece != null)
        board.blackPieces.add(t2);
      if (t2.piece.constructor.name == 'King')
        board.whiteKing = t1;
    }
    else {
      board.blackPieces.delete(t2);
      board.blackPieces.add(t1);
      if (this.lastPiece != null)
        board.whitePieces.add(t2);
      if (t2.piece.constructor.name == 'King')
        board.blackKing = t1;
    }
    t1.piece = t2.piece;
    t2.piece = this.lastPiece;
    if (!isSimulation) {
      t1.draw();
      t2.draw();
      t1.piece.unmove();
      if (t1.piece.isPromoted == 0)
        this.master.demote(t1);
    }
  }
}


class Castle extends Move {
  constructor(t1, t2, t3, t4, master) {
    super(t1, t2, master);
    this.t3 = t3;
    this.t4 = t4;
    this.kingMove = new Move(this.t1, this.t2, this.master);
    this.rookMove = new Move(this.t3, this.t4, this.master);
  }

  makeMove(isSimulation) {
    this.kingMove.makeMove(isSimulation);
    this.rookMove.makeMove(isSimulation);
  }

  unmakeMove(isSimulation) {
    this.kingMove.unmakeMove(isSimulation);
    this.rookMove.unmakeMove(isSimulation);
  }
}


class EnPassant extends Move {
  constructor(t1, t2, t3, master) {
    super(t1, t2, master);
    this.t3 = t3;
    this.t3Piece = t3.piece;
    this.enPassant = new Move(this.t1, this.t2, this.master);
    this.isCapture = true;
  }

  makeMove(isSimulation) {
    if (this.t3Piece.color == 'black') {
      this.master.blackPieces.delete(this.t3);
    }
    else {
      this.master.whitePieces.delete(this.t3);
    }
    this.enPassant.makeMove(isSimulation);
    this.t3.piece = null;
    if (!isSimulation) {
      this.t3.draw();
    }

  }

  unmakeMove(isSimulation) {
    this.enPassant.unmakeMove(isSimulation);
    if (this.t3Piece.color == 'black')
      this.master.blackPieces.add(this.t3);
    else
      this.master.whitePieces.add(this.t3);
    this.t3.piece = this.t3Piece;
    if (!isSimulation)
      this.t3.draw();
  }
}


class Board {
  constructor(setup) {
    this.board = new Array(8);
    for (var i=0; i<this.board.length; i++) {
      this.board[i] = new Array(8);
      for (var j=0; j<this.board[i].length; j++) {
        this.board[i][j] = new Tile(j, 7-i, null);
        this.board[i][j].draw();
      }
    }
    this.focused = null;
    this.currentMoves = [];
    this.whitePieces = new Set();
    this.blackPieces = new Set();
    this.whiteMoves = new Set();
    this.blackMoves = new Set();
    this.whiteTiles = null;
    this.blackTiles = null;
    this.movesGrid = new Array(8);
    for (var i=0; i<this.movesGrid.length; i++) {
      this.movesGrid[i] = new Array(8);
      for (var j=0; j<this.movesGrid[i].length; j++)
        this.movesGrid[i][j] = [];
    }
    this.captureSound = new Audio('sounds/capture.mp3');
    this.moveSound = new Audio('sounds/move.mp3');
    this.castleSound = new Audio('sounds/castle.mp3');
    this.checkSound = new Audio('sounds/check.mp3');
    this.lastMove = null;
    this.colors = ['white', 'black']
    this.moveList = [];
    this.forwardPath = [];
    this.turn = 0;
    this.checked = false;
    this.setupBoard(setup);
    this.getAllMoves(this.colors[this.turn]);
  }

  update() {
    for (var i=0; i<this.board.length; i++) {
      for (var j=0; j<this.board[i].length; j++) {
        this.board[i][j].clear();
      }
    }
  }

  copy() {
    var newBoard = new Board('', true);
    for (var i=0; i<this.board.length; i++) {
      for (var j=0; j<this.board[i].length; j++) {
        newBoard.board[i][j] = this.board[i][j].copy();
        if (this.board[i][j].piece != null) {
          if (this.board[i][j].piece.color == 'white') {
            if (this.board[i][j].piece.constructor.name == 'King')
              newBoard.whiteKing = newBoard.board[i][j];
            newBoard.whitePieces.add(newBoard.board[i][j]);
          }
          else {
            if (this.board[i][j].piece.constructor.name == 'King')
              newBoard.blackKing = newBoard.board[i][j];
            newBoard.blackPieces.add(newBoard.board[i][j]);
          }
        }
      }
    }
    return newBoard;
  }

  simulate(move)  {
    move.makeMove(true);
  }

  callback(move) {
    move.unmakeMove(true);
  }

  validKing(color) {
    if (color == 'black') {
      var tile = this.blackKing;
      var moves = this.getControlledTiles('white');
    }
    else {
      var tile = this.whiteKing;
      var moves = this.getControlledTiles('black');
    }
    return (!moves.has(tile));
  }

  getControlledTiles(color) {
    if (color == 'white') {
      var tiles = this.whitePieces;
    }
    else {
      var tiles = this.blackPieces;
    }
    var allMoves = new Set();
    for (var tile of tiles) {
      allMoves = new Set([...allMoves, ...tile.piece.getTakingMoves(7-tile.y, tile.x, this.board)]);
    }
    return allMoves;
  }

  promote(tile) {
    tile.piece = new Queen(tile.piece.color, this, 1);
  }

  demote(tile) {
    tile.piece = new Pawn(tile.piece.color, this);
  }

  checkPromotion() {
    for (var i=0; i<this.board[0].length; i++) {
      if (this.board[0][i].piece != null && this.board[0][i].piece.constructor.name == 'Pawn') {
        this.promote(this.board[0][i]);
        return;
      }
      if (this.board[this.board.length-1][i].piece != null && this.board[this.board.length-1][i].piece.constructor.name == 'Pawn') {
        this.promote(this.board[this.board.length-1][i]);
        return;
      }
    }
  }

  checkCastling(color) {
    if (color == 'white') {
      var index = 0;
      var moves = this.getControlledTiles('black');
    }
    else {
      var index = this.board.length-1;
      var moves = this.getControlledTiles('white');
    }
    var res = [];
    var t1 = this.board[index][4];
    var t2 = this.board[index][0];
    var t3 = this.board[index][this.board[index].length-1];
    if (t1.piece != null && t1.piece.constructor.name == 'King' && !t1.piece.hasMoved) {
      if (t2.piece != null && t2.piece.constructor.name == 'Rook'&& !t2.piece.hasMoved) {
        var valid = (!(moves.has(this.board[index][4])) && this.board[index][1].piece == null);
        for (var j=2; j<4; j++) {
          if (this.board[index][j].piece != null || moves.has(this.board[index][j])) {
            valid = false;
          }
        }
        if (valid)
          res.push([this.board[index][4], this.board[index][2], this.board[index][0], this.board[index][3]]);
      }
      if (t3.piece != null && t3.piece.constructor.name == 'Rook' && !t3.piece.hasMoved) {
        var valid = !(moves.has(this.board[index][4]));
        for (var j=5; j<=6; j++) {
          if (this.board[index][j].piece != null || moves.has(this.board[index][j]))
            valid = false;
        }
        if (valid)
          res.push([this.board[index][4], this.board[index][6], this.board[index][this.board.length-1], this.board[index][5]]);
        }
      }
      return res;
  }

  checkEnPassant(color) {
    if (this.lastMove == null || this.lastMove.t2.piece.constructor.name != 'Pawn' || this.lastMove.t2.piece.color == color || Math.abs(this.lastMove.t2.y - this.lastMove.t1.y) != 2)
      return [];
    if (color == 'white') {
      var incr = 1;
      var index = 4;
    }
    else {
      var incr = -1;
      var index = 3;
    }
    var moves = [];
    var j = this.lastMove.t2.x;
    if (j-1 >= 0) {
      if (this.board[index][j-1].piece != null && this.board[index][j-1].piece.constructor.name == 'Pawn' && this.board[index][j-1].piece.color == color)
        moves.push([this.board[index][j-1], this.board[index+incr][j], this.board[index][j]]);
    }
    if (j+1 < this.board[index].length) {
      if (this.board[index][j+1].piece != null && this.board[index][j+1].piece.constructor.name == 'Pawn' && this.board[index][j+1].piece.color == color) {
        moves.push([this.board[index][j+1], this.board[index+incr][j], this.board[index][j]]);
      }
    }
    return moves;
  }

  playSound(move) {
    if (this.checked)
      this.checkSound.play();
    else if (move.isCapture)
      this.captureSound.play();
    else if (move.constructor.name == "Castle")
      this.castleSound.play();
    else
      this.moveSound.play();
  }

  movePiece(move) {
    move.makeMove(false, true);
    move.t1.highlight();
    move.t2.highlight();
    this.lastMove = move;
    this.turn = (this.turn+1) % 2;
    this.moveList.push(move);
    var moves = this.getAllMoves(this.colors[this.turn]);
    this.checked = this.inCheck(this.colors[this.turn]);
    this.forwardList = [];
    this.playSound(move);
    if (this.checked) {
      if (this.turn == 0)
        this.whiteKing.alert();
      else
        this.blackKing.alert();
      if (moves.length == 0) {
        console.log('asd');
        ctx.font = "30px Arial";
        ctx.fillStyle = "black";
        ctx.textAlign = "center";
        ctx.fillText('Checkmate!', 1000, 400);
      }
    }
    else {
      if (this.whiteKing.isAlerted())
        this.whiteKing.clear();
      if (this.blackKing.isAlerted())
        this.blackKing.clear();
    }
  }

  selectTile(e) {
    const i = 7-Math.floor(e.clientY / 100);
    const j = Math.floor(e.clientX / 100);
    var moved = false
    for (var move of this.currentMoves) {
      if (!moved && this.board[i][j] == move.t2) {
        this.movePiece(move);
        var moved = true;
      }
      else
        move.t2.clear();
    }
    this.currentMoves = [];
    if (moved)
      return;
    if (this.board[i][j].piece == null || this.board[i][j].piece.color != this.colors[this.turn])
      return;
    if (this.lastMove != null && this.lastMove.t1.isHighlighted()) {
      this.lastMove.t2.clear();
      this.lastMove.t1.clear();
    }
    if (this.focused == this.board[i][j]) {
      this.focused.clear();
      this.focused = null;
    }
    else {
      if (this.focused != null)
        this.focused.clear();
      this.focused = this.board[i][j];
      this.board[i][j].highlight();

      this.currentMoves = this.movesGrid[i][j];
      for (var move of this.currentMoves) {
        move.t2.showMove();
      }
    }
    if (this.checked) {
      if (this.turn == 0)
        this.whiteKing.alert();
      else
        this.blackKing.alert();
    }
    else {
      if (this.whiteKing.isAlerted())
        this.whiteKing.clear();
      if (this.blackKing.isAlerted())
        this.blackKing.clear();
    }
  }

  setupTile(i, j, s) {
    if (s == s.toUpperCase())
      this.whitePieces.add(this.board[i][j]);
    else
      this.blackPieces.add(this.board[i][j]);
    if (s == 'p')
      this.board[i][j].piece = new Pawn('black', this);
    else if (s == 'P')
      this.board[i][j].piece = new Pawn('white', this);
    else if (s == 'n')
      this.board[i][j].piece = new Knight('black', this);
    else if (s == 'N')
      this.board[i][j].piece = new Knight('white', this);
    else if (s == 'b')
      this.board[i][j].piece = new Bishop('black', this);
    else if (s=='B')
      this.board[i][j].piece = new Bishop('white', this);
    else if (s == 'r')
      this.board[i][j].piece = new Rook('black', this);
    else if (s == 'R')
      this.board[i][j].piece = new Rook('white', this);
    else if (s == 'q')
      this.board[i][j].piece = new Queen('black', this);
    else if (s == 'Q')
      this.board[i][j].piece = new Queen('white', this);
    else if (s == 'k') {
      this.blackKing = this.board[i][j];
      this.board[i][j].piece = new King('black', this);
    }
    else if (s == 'K') {
      this.whiteKing = this.board[i][j];
      this.board[i][j].piece = new King('white', this);
    }
  }

  setupBoard(setup) {
    var tmp = setup.split("/");
    for (var i=0; i<tmp.length; i++) {
      var j = 0;
      for (var k=0; k<tmp[i].length; k++) {
        if (!Number.isNaN(parseInt(tmp[i][k]))) {
          j += parseInt(tmp[i][k]);
          continue;
        }
        this.setupTile(7-i, j, tmp[i][k]);
        j += 1;
      }
    }
    this.update();
    c.addEventListener('click', this.selectTile.bind(this));
    c.addEventListener('keydown', this.takeBack.bind(this));
    c.addEventListener('keydown', this.forward.bind(this));
  }

  forward(e) {
    if (e.keyCode != '39' || this.forwardList.length == 0)
      return;
    this.turn = (this.turn+1)%2;
    var move = this.forwardList.pop();
    this.lastMove = move;
    this.moveList.push(move);
    move.makeMove(false, true);
    this.getAllMoves(this.colors[this.turn]);
    this.resetFocus();
    this.update();
  }

  takeBack(e) {
    if (e.keyCode != '37' || this.moveList.length == 0)
      return;
    this.turn = (this.turn+1)%2;
    var move = this.moveList.pop();
    this.forwardList.push(move);
    if (this.moveList.length == 0)
      this.lastMove = null;
    else
      this.lastMove = this.moveList[this.moveList.length-1];
    move.unmakeMove(false);
    this.getAllMoves(this.colors[this.turn]);
    move.t1.clear();
    move.t2.clear();
    this.resetFocus();
    this.checked = false;
    this.update();
  }

  inCheck(color) {
    if (color == 'white')
      return (this.getControlledTiles('black').has(this.whiteKing));
    return (this.getControlledTiles('white').has(this.blackKing));
  }

  getAllMoves(color) {
    if (color == 'white')
      var tiles = this.whitePieces;
    else
      var tiles = this.blackPieces;
    var moves = [];
    for (var tile of tiles) {
      if (this.movesGrid[7-tile.y][tile.x].length != 0)
        this.movesGrid[7-tile.y][tile.x] = [];
      var tmp = [];
      var currentMoves = tile.piece.moves(7-tile.y, tile.x);
      for (var move of currentMoves) {
        moves.push(move);
      }
    }
    var tmp = [];
    for (var move of moves) {
      this.simulate(move);
      var valid = this.validKing(color);
      this.callback(move);
      if (valid) {
        this.movesGrid[7-move.t1.y][move.t1.x].push(move);
        tmp.push(move);
      }
    }
    return tmp;
  }

  resetFocus() {
    if (this.focused != null)
      this.focused.clear();
    this.currentMoves = [];
  }
}


class Game {
  constructor(setup) {
    this.board = new Board(setup);
  }
}


var setupString = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
// setupString = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8';
game = new Game(setupString);
