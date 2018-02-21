/*
 * This module detects furigana for a given input string containing kanji
 * and renders it into a PNG buffer. Optimizations for speed have been made.
 *
 * Full project source: https://github.com/mistval/render_furigana
 */

const Canvas = require('canvas');
const fs = require('fs');
const assert = require('assert');

const HAIR_SPACE = '\u200A';

let kuroshiro;
try {
  kuroshiro = require('kuroshiro');
} catch (err) {
  // kuroshiro is only necessary if you want automatic furigana detection.
}

let htmlparser;
try {
  htmlparser = require('htmlparser');
} catch (err) {
  // htmlparser is only necessary if you want automatic furigana detection.
}

// Initialize kuroshiro
const kuroshiroInit = new Promise((fulfill, reject) => {
  if (kuroshiro) {
    kuroshiro.init(err => {
      if (err) {
        reject(err);
      } else {
        fulfill();
      }
    });
  } else {
    fulfill();
  }
});

function extractFurigana(text) {
  if (!kuroshiro) {
    throw new Error('Could not load kuroshiro, which is necessary for automatically detecting furigana. You must install kuroshiro (which is an optional dependency) in order to use automatic furigana detection.');
  }
  if (!htmlparser) {
    throw new Error('Could not load htmlparser, which is necessary for automatically detecting furigana. You must install htmlparser (which is an optional dependency) in order to use automatic furigana detection.');
  }
  return kuroshiroInit.then(() => {
    let kuroshiroResults = kuroshiro.convert(text, {mode: 'furigana'});
    let parseHandler = new htmlparser.DefaultHandler(function(error, dom) {});
    let parser = new htmlparser.Parser(parseHandler);
    parser.parseComplete(kuroshiroResults);
    let kuroshiroResultsAsDom = parseHandler.dom;

    /*
     * Kuroshiro returns results as an array of ruby elements.
     * See here for information about how those work:
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ruby
     * Below, we convert the rubys to a more convenient structure.
     */
    let results = [];
    for (let element of kuroshiroResultsAsDom) {
      let thisResult = {kanji: '', furigana: ''};
      if (element.name === 'ruby') {
        for (let child of element.children) {
          if (child.type === 'text') {
            thisResult.kanji += child.raw;
          } else if (child.name === 'rt') {
            let thisFurigana = child.children.map(innerChild => innerChild.raw).join('');
            if (thisFurigana !== thisResult.kanji) {
              thisResult.furigana += thisFurigana;
            }
          }
        }
      } else if (element.type === 'text') {
        thisResult.kanji += element.raw;
      }
      results.push(thisResult);
    }
    return results;
  });
}

class PositionedChunk {
  constructor(x, chunk) {
    this.x = x,
    this.chunk = chunk;
  }
}

class Line {
  constructor(maxWidth, paddingBetweenFuriganaAndKanji) {
    this.paddingBetweenFuriganaAndKanji_ = paddingBetweenFuriganaAndKanji;
    this.maxWidth_ = maxWidth;
    this.widthRemaining_ = maxWidth;
    this.height_ = 0;
    this.positionedChunks = [];
    this.furiganaPartHeight_ = 0;
    this.kanjiPartHeight_ = 0;
  }

  canAddChunk(chunk) {
    return chunk.calculateWidth() <= this.widthRemaining_;
  }

  addChunk(chunk) {
    let x = this.maxWidth_ - this.widthRemaining_;
    this.widthRemaining_ -= chunk.calculateWidth();
    this.positionedChunks.push(new PositionedChunk(x, chunk));
    this.furiganaPartHeight_ = Math.max(this.furiganaPartHeight_, chunk.getFuriganaHeight());
    this.kanjiPartHeight_ = Math.max(this.kanjiPartHeight_, chunk.getKanjiHeight());
  }

  getWidth() {
    return this.maxWidth_ - this.widthRemaining_;
  }

  calculateHeight() {
    let height = this.furiganaPartHeight_ + this.kanjiPartHeight_;
    if (this.furiganaPartHeight_ !== 0) {
      height += this.paddingBetweenFuriganaAndKanji_;
    }
    return height;
  }

  drawKanji(ctx, xOffset, yOffset) {
    let kanjiString = '';
    for (let positionedChunk of this.positionedChunks) {
      kanjiString += positionedChunk.chunk.kanji;
    }
    let kanjiStringMetrics = ctx.measureText(kanjiString);
    ctx.fillText(
      kanjiString,
      xOffset,
      yOffset + kanjiStringMetrics.actualBoundingBoxAscent + this.furiganaPartHeight_ + this.paddingBetweenFuriganaAndKanji_);
  }

  drawFurigana(ctx, xOffset, yOffset) {
    for (let positionedChunk of this.positionedChunks) {
      ctx.fillText(
        positionedChunk.chunk.furigana,
        xOffset + positionedChunk.x + positionedChunk.chunk.furiganaXOffset,
        yOffset + positionedChunk.chunk.getFuriganaYOffset());
    }
  }
}

class Chunk {
  constructor(kanji, furigana) {
    const spacesPerIdeographicSpace = 2;
    this.kanji = kanji.replace(/\u3000/g, Array(spacesPerIdeographicSpace + 1).join(' '));
    this.furigana = furigana || '';
    this.furiganaXOffset = 0;
    this.kanjiXOffset_ = 0;
  }

  calculateKanjiMetrics(ctx) {
    this.kanjiMetrics_ = ctx.measureText(this.kanji);
  }

  calculateFuriganaMetrics(ctx) {
    this.furiganaMetrics_ = ctx.measureText(this.furigana);
  }

  calculateWidth() {
    return Math.max(this.kanjiMetrics_.width, this.furiganaMetrics_.width);
  }

  getHeight_(metrics) {
    return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  }

  getFuriganaHeight() {
    return this.getHeight_(this.furiganaMetrics_);
  }

  getKanjiHeight() {
    return this.getHeight_(this.kanjiMetrics_);
  }

  getFuriganaYOffset() {
    return this.furiganaMetrics_.actualBoundingBoxAscent;
  }

  addPaddingAndCalculateOffsets(hairSpaceWidth) {
    assert(this.kanjiMetrics_ && this.furiganaMetrics_, 'Need to call calculateKanjiMetrics and calculateFuriganaMetrics first');
    this.kanjiXOffset_ = Math.max((this.furiganaMetrics_.width - this.kanjiMetrics_.width) / 2, 0);
    this.furiganaXOffset = Math.max((this.kanjiMetrics_.width - this.furiganaMetrics_.width) / 2, 0);
    if (this.kanjiXOffset_ > 0) {
      let spacePaddingNeededPerSide = Math.ceil(this.kanjiXOffset_ / hairSpaceWidth);
      let spacePaddingPerSide = Array(spacePaddingNeededPerSide + 1).join(HAIR_SPACE);
      this.kanji = spacePaddingPerSide + this.kanji + spacePaddingPerSide;
      this.kanjiMetrics_.width += spacePaddingNeededPerSide * 2 * hairSpaceWidth;
    }
  }
}

function startsWithNewline(chunk) {
  return chunk.kanji.startsWith('\n');
}

function removeNewlines(chunk) {
  chunk.kanji = chunk.kanji.replace(/\n/g, '');
  return chunk;
}

function draw(rawChunks, kanjiFont, furiganaFont, options) {
  assert(typeof kanjiFont === typeof '', 'No kanji font provided. You must provide a font name as a string.');
  assert(typeof furiganaFont === typeof '', 'No furigana font provided. You must provide a font name as a string.');
  options = options || {};
  let maxAllowedPaddedWidth = options.maxWidthInPixels || 1000;
  let minAllowedPaddedWidth = options.minWidthInPixels || 0;
  let maxAllowedPaddedHeight = options.maxHeightInPixels || Number.MAX_SAFE_INTEGER;
  let minAllowedPaddedHeight = options.minHeightInPixels || 0;
  let leftPadding = options.leftPaddingInPixels || 10;
  let rightPadding = options.rightPaddingInPixels || 10;
  let topPadding = options.topPaddingInPixels || 10;
  let bottomPadding = options.bottomPaddingInPixels || 10;
  let paddingBetweenFuriganaAndKanji = options.paddingBetweenFuriganaAndKanjiInPixels || 3;
  let paddingBetweenLines = options.paddingBetweenLinesInPixels || 10;
  let backgroundColor = options.backgroundColor || 'white';
  let textColor = options.textColor || 'black';
  let maxAllowedUnpaddedWidth = maxAllowedPaddedWidth - leftPadding - rightPadding;
  let maxAllowedUnpaddedHeight = maxAllowedPaddedHeight - topPadding - bottomPadding;
  let chunks = [];
  for (let rawChunk of rawChunks) {
    chunks.push(new Chunk(rawChunk.kanji, rawChunk.furigana));
  }

  let canvas = new Canvas(0, 0);
  let ctx = canvas.getContext('2d');

  // Calculate the kanji metrics
  ctx.font = kanjiFont;
  let hairSpaceWidth = ctx.measureText(HAIR_SPACE).width;
  for (let chunk of chunks) {
    chunk.calculateKanjiMetrics(ctx);
  }

  // Calculate the furigana metrics
  // (We calculate the furigana and kanji netrics in separate loops because setting the font on the canvas context is pretty slow)
  ctx.font = furiganaFont;
  for (let chunk of chunks) {
    chunk.calculateFuriganaMetrics(ctx);
  }

  for (let chunk of chunks) {
    chunk.addPaddingAndCalculateOffsets(hairSpaceWidth);
  }

  let lines = [];
  let currentLine = new Line(maxAllowedUnpaddedWidth, paddingBetweenFuriganaAndKanji);
  lines.push(currentLine);
  for (let chunk of chunks) {
    if (!currentLine.canAddChunk(chunk) || startsWithNewline(chunk)) {
      currentLine = new Line(maxAllowedUnpaddedWidth, paddingBetweenFuriganaAndKanji);
      lines.push(currentLine);
    }
    currentLine.addChunk(removeNewlines(chunk));
  }

  let totalHeight = 0;
  for (let line of lines) {
    totalHeight += line.calculateHeight();
    totalHeight += paddingBetweenLines;
  }
  totalHeight -= paddingBetweenLines;
  totalHeight += topPadding;
  totalHeight += bottomPadding;

  let maxWidth = 0;
  for (let line of lines) {
    maxWidth = Math.max(maxWidth, line.getWidth());
  }
  maxWidth += leftPadding;
  maxWidth += rightPadding;

  // Set the canvas to the correct size.
  canvas.width = maxWidth;
  canvas.height = totalHeight;

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = textColor;
  let xOffset = leftPadding;
  let yOffset = topPadding;
  for (let line of lines) {
    line.drawFurigana(ctx, xOffset, yOffset);
    yOffset += line.calculateHeight() + paddingBetweenLines;
  }

  ctx.font = kanjiFont;
  yOffset = topPadding;
  for (let line of lines) {
    line.drawKanji(ctx, xOffset, yOffset);
    yOffset += line.calculateHeight() + paddingBetweenLines;
  }

  return new Promise((fulfill, reject) => {
    canvas.toBuffer((err, buffer) => {
      if (err) {
        reject(err);
      } else {
        fulfill(buffer);
      }
    });
  });
}

/**
* If a chunk does not contain furigana, split its kana into one chunk per character.
* This is only done for automatically detected furigana.
* In the case of automatically detected furigana, it leads to more natural line breaking.
*/
function splitNonFuriganaChunks(chunks) {
  let newRawChunks = [];
  let nextNonKanaChunk;
  for (let chunk of chunks) {
    if (!chunk.furigana) {
      let characters = chunk.kanji.split('');
      for (let character of characters) {
        let isKana = character >= '\u3040' && character <= '\u30FF';
        if (isKana) {
          nextNonKanaChunk = undefined;
          newRawChunks.push({kanji: character});
        } else {
          if (!nextNonKanaChunk) {
            nextNonKanaChunk = {kanji: ''};
            newRawChunks.push(nextNonKanaChunk);
          }
          nextNonKanaChunk.kanji += character;
        }
      }
    } else {
      nextNonKanaChunk = undefined;
      newRawChunks.push(chunk);
    }
  }
  return newRawChunks;
}

module.exports = function(text, kanjiFont, furiganaFont, options) {
  assert(text, 'No text provided. You must provide a string or an array of {kanji:xx, furigana:xx}');
  if (typeof text === typeof '') {
    return extractFurigana(text).then(rawChunks => {
      rawChunks = splitNonFuriganaChunks(rawChunks);
      return draw(rawChunks, kanjiFont, furiganaFont, options);
    });
  } else {
    return draw(text, kanjiFont, furiganaFont, options);
  }
}
