'use strict'
const reload = require('require-reload')(require);
const Canvas = require('canvas');
const fs = require('fs');
const assert = require('assert');

let kuroshiro;
try {
  kuroshiro = require('kuroshiro');
} catch (err) {
  // It's only necessary if you want automatic furigana detection.
}

let htmlparser;
try {
  htmlparser = require('htmlparser');
} catch (err) {
  // It's only necessary if you want automatic furigana detection.
}

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

    let results = [];
    for (let element of kuroshiroResultsAsDom) {
      let thisResult = {kanji: '', furigana: ''};
      if (element.name === 'ruby') {
        for (let child of element.children) {
          if (child.type === 'text') {
            thisResult.kanji += child.raw;
          } else if (child.name === 'rt') {
            thisResult.furigana += child.children.map(innerChild => innerChild.raw).join('');
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

class Line {
  constructor(paddingBetweenFuriganaAndKanjiInPixels) {
    this.chunks_ = [];
    this.widthInPixels_ = 0;
    this.heightInPixels_ = 0;
    this.paddingBetweenFuriganaAndKanjiInPixels_ = paddingBetweenFuriganaAndKanjiInPixels;
    this.furiganaPartHeightInPixels_ = 0;
    this.kanjiPartHeightInPixels_ = 0;
  }

  addChunk(chunk) {
    this.widthInPixels_ += Math.max(chunk.kanjiWidthInPixels || 0, chunk.furiganaWidthInPixels || 0);
    this.furiganaPartHeightInPixels_ = Math.max(this.furiganaPartHeightInPixels_ || 0, chunk.furiganaHeightInPixels || 0);
    this.kanjiPartHeightInPixels_ = Math.max(this.kanjiPartHeightInPixels_ || 0, chunk.kanjiHeightInPixels || 0);
    this.chunks_.push(chunk);
  }

  getWidth() {
    return this.widthInPixels_;
  }

  getHeight() {
    return this.furiganaPartHeightInPixels_ + this.kanjiPartHeightInPixels_ + this.paddingBetweenFuriganaAndKanjiInPixels_;
  }

  hasSpaceLeft(kanjiWidth, furiganaWidth, leftPaddingInPixels, rightPaddingInPixels, maxWidthInPixels) {
    let chunkWidthInPixels = Math.max(kanjiWidth || 0, furiganaWidth || 0);
    return chunkWidthInPixels <= maxWidthInPixels - this.getWidth() - (leftPaddingInPixels + rightPaddingInPixels);
  }

  getRenderInformation() {
    let informations = [];
    let nextChunkStartLeftInPixels = 0;
    for (let chunk of this.chunks_) {
      let chunkWidthInPixels = Math.max(chunk.kanjiWidthInPixels || 0, chunk.furiganaWidthInPixels || 0);
      let furiganaStartTopInPixels = chunk.furiganaActualBoundingBoxAscentInPixels;
      let kanjiStartTopInPixels = this.furiganaPartHeightInPixels_
        + this.paddingBetweenFuriganaAndKanjiInPixels_
        + chunk.kanjiActualBoundingBoxAscentInPixels
        + (this.kanjiPartHeightInPixels_ - chunk.kanjiHeightInPixels) / 2;
      let furiganaStartLeftInPixels = nextChunkStartLeftInPixels + (chunkWidthInPixels - chunk.furiganaWidthInPixels) / 2;
      let kanjiStartLeftInPixels = nextChunkStartLeftInPixels + (chunkWidthInPixels - chunk.kanjiWidthInPixels) / 2;
      informations.push({
        kanji: chunk.kanji,
        furigana: chunk.furigana,
        furiganaStartTopInPixels: furiganaStartTopInPixels,
        furiganaStartLeftInPixels: furiganaStartLeftInPixels,
        kanjiStartTopInPixels: kanjiStartTopInPixels,
        kanjiStartLeftInPixels: kanjiStartLeftInPixels,
      });
      nextChunkStartLeftInPixels += chunkWidthInPixels;
    }

    return informations;
  }
}

function getWidthAndHeightAndActualBoundingBoxAscent(ctx, text) {
  let measurement = ctx.measureText(text);
  let widthInPixels = measurement.width;
  let heightInPixels = measurement.actualBoundingBoxAscent + measurement.actualBoundingBoxDescent;
  return [widthInPixels, heightInPixels, measurement.actualBoundingBoxAscent];
}

function calculatePageWidth(lines) {
  let widthInPixels = 0;
  for (let line of lines) {
    widthInPixels = Math.max(widthInPixels, line.getWidth());
  }
  return widthInPixels;
}

function calculatePageHeight(lines, interLinePaddingInPixels) {
  let heightInPixels = 0;
  for (let line of lines) {
    heightInPixels += line.getHeight();
  }
  return heightInPixels + (lines.length - 1) * interLinePaddingInPixels;
}

function draw(chunks, kanjiFont, furiganaFont, options) {
  assert(typeof kanjiFont === typeof '', 'No kanji font provided. You must provide a font name as a string.');
  assert(typeof furiganaFont === typeof '', 'No furigana font provided. You must provide a font name as a string.');
  options = options || {};
  let maxAllowedWidthInPixels = options.maxWidthInPixels || 1000;
  let minAllowedWidthInPixels = options.minWidthInPixels || 0;
  let maxAllowedHeightInPixels = options.maxHeightInPixels || Number.MAX_SAFE_INTEGER;
  let minAllowedHeightInPixels = options.minHeightInPixels || 0;
  let leftPaddingInPixels = options.leftPaddingInPixels || 0;
  let rightPaddingInPixels = options.rightPaddingInPixels || 0;
  let topPaddingInPixels = options.topPaddingInPixels || 0;
  let bottomPaddingInPixels = options.bottomPaddingInPixels || 0;
  let paddingBetweenFuriganaAndKanjiInPixels = options.paddingBetweenFuriganaAndKanjiInPixels || 3;
  let paddingBetweenLinesInPixels = options.paddingBetweenLinesInPixels || 5;
  let backgroundColor = options.backgroundColor || 'white';
  let textColor = options.backgroundColor || 'black';

  let canvas = new Canvas(0, 0);
  let ctx = canvas.getContext('2d');

  // Calculate the width of each chunk's Kanji
  ctx.font = kanjiFont;
  for (let chunk of chunks) {
    let kanji = chunk.kanji;
    if (kanji) {
      [chunk.kanjiWidthInPixels, chunk.kanjiHeightInPixels, chunk.kanjiActualBoundingBoxAscentInPixels] =
        getWidthAndHeightAndActualBoundingBoxAscent(ctx, kanji);
    }
  }

  // Calculate the width of each chunk's Furigana
  // (We calculate the furigana and kanji width in separate loops because setting the font on the canvas context is pretty slow)
  ctx.font = furiganaFont;
  for (let chunk of chunks) {
    let furigana = chunk.furigana;
    if (furigana) {
      [chunk.furiganaWidthInPixels, chunk.furiganaHeightInPixels, chunk.furiganaActualBoundingBoxAscentInPixels] =
        getWidthAndHeightAndActualBoundingBoxAscent(ctx, furigana);
    }
  }

  // Organize the results into lines
  let lines = [];
  let currentLine = new Line(paddingBetweenFuriganaAndKanjiInPixels);
  lines.push(currentLine);
  for (let chunk of chunks) {
    let lineHasSpaceLeft = currentLine.hasSpaceLeft(
      chunk.kanjiWidthInPixels,
      chunk.furiganaWidthInPixels,
      leftPaddingInPixels,
      rightPaddingInPixels,
      maxAllowedWidthInPixels);

    if (!lineHasSpaceLeft) {
      currentLine = new Line(paddingBetweenFuriganaAndKanjiInPixels);
      lines.push(currentLine);
    }

    currentLine.addChunk(chunk);
  }

  // Set the canvas to the correct size.
  canvas.width = Math.max(
    Math.min(
      calculatePageWidth(lines) + leftPaddingInPixels + rightPaddingInPixels,
      maxAllowedWidthInPixels),
    minAllowedWidthInPixels);
  canvas.height = Math.max(
    Math.min(
      calculatePageHeight(lines, paddingBetweenLinesInPixels) + leftPaddingInPixels + rightPaddingInPixels,
      maxAllowedHeightInPixels),
    minAllowedHeightInPixels);

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw the results on the canvas.
  // One loop for kanji and one loop for furigana.
  // Because we save a lot of time if we only set the font twice.
  ctx.fillStyle = textColor;
  let lineStartLeftInPixels = leftPaddingInPixels;
  let lineStartTopInPixels = topPaddingInPixels;
  ctx.font = furiganaFont;
  for (let line of lines) {
    let renderInformations = line.getRenderInformation();
    for (let renderInformation of renderInformations) {
      if (renderInformation.furigana) {
        ctx.fillText(
          renderInformation.furigana,
          lineStartLeftInPixels + renderInformation.furiganaStartLeftInPixels,
          lineStartTopInPixels + renderInformation.furiganaStartTopInPixels);
      }
    }
    lineStartTopInPixels += line.getHeight() + paddingBetweenLinesInPixels;
  }
  lineStartLeftInPixels = leftPaddingInPixels
  lineStartTopInPixels = topPaddingInPixels
  ctx.font = kanjiFont;
  for (let line of lines) {
    let renderInformations = line.getRenderInformation();
    for (let renderInformation of renderInformations) {
      if (renderInformation.kanji) {
        ctx.fillText(
          renderInformation.kanji,
          lineStartLeftInPixels + renderInformation.kanjiStartLeftInPixels,
          lineStartTopInPixels + renderInformation.kanjiStartTopInPixels);
      }
    }
    lineStartTopInPixels += line.getHeight() + paddingBetweenLinesInPixels;
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
  let newChunks = [];
  let nextNonKanaChunk;
  for (let chunk of chunks) {
    if (!chunk.furigana) {
      let characters = chunk.kanji.split('');
      for (let character of characters) {
        let isKana = character >= '\u3040' && character <= '\u30FF';
        if (isKana) {
          if (nextNonKanaChunk) {
            nextNonKanaChunk = undefined;
          }
          newChunks.push({kanji: character});
        } else {
          if (!nextNonKanaChunk) {
            nextNonKanaChunk = {kanji: ''};
            newChunks.push(nextNonKanaChunk);
          }
          nextNonKanaChunk.kanji += character;
        }
      }
    } else {
      newChunks.push(chunk);
    }
  }

  return newChunks;
}

module.exports = function(text, kanjiFont, furiganaFont, options) {
  assert(text, 'No text provided. You must provide a string or an array of {kanji:xx, furigana:xx}');
  if (typeof text === typeof '') {
    return extractFurigana(text).then(chunks => {
      chunks = splitNonFuriganaChunks(chunks);
      return draw(chunks, kanjiFont, furiganaFont, options);
    });
  } else {
    return draw(text, kanjiFont, furiganaFont, options);
  }
}
