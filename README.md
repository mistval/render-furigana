# Render Furigana
Render Japanese text with furigana to a PNG buffer.

You can specify the furigana yourself, or you can have the script do it automatically, using kuroshiro.

Cairo is required for image rendering. If you don't have it installed, see canvas' page for instructions: https://www.npmjs.com/package/canvas

## Examples
```js
const renderFurigana = require('render-furigana');
const fs = require('fs');
const kanjiFont = '40px IPAMincho';
const furiganaFont = '20px IPAMincho';

renderFurigana('暴走した｢西武バス｣踏切内進入の一部始終', kanjiFont, furiganaFont).then(pngBuffer => {
  fs.writeFileSync('./output.png', pngBuffer);
});
```

Result:
![Result 1 png](https://preview.ibb.co/gWcnmR/output1.png "Result 1 png")
```js
renderFurigana([{kanji: 'word1', furigana: 'one'}, {kanji: '  '}, {kanji: 'word-two', furigana: 'two'}], kanjiFont, furiganaFont).then(pngBuffer => {
  fs.writeFileSync('./output.png', pngBuffer);
});
```

Result:
![Result 2 png](https://image.ibb.co/gbqjY6/output2.png "Result 2 png")
```js
let options = {
  backgroundColor: 'rgba(255, 0, 0, 1)',
  textColor: 'rgba(0, 0, 255, 1)',
}

renderFurigana('青と赤', kanjiFont, furiganaFont, options).then(pngBuffer => {
  fs.writeFileSync('./output.png', pngBuffer);
});
```
Result:
![Result 3 png](https://image.ibb.co/bsxL6R/output3.png "Result 3 png")
## Options
You can pass in an options object as the fourth argument. The defaults are:
```js
{
  maxWidthInPixels: 1000,
  minWidthInPixels: 0,
  maxHeightInPixels: Number.MAX_SAFE_INTEGER,
  minHeightInPixels: 0,
  leftPaddingInPixels: 10,
  rightPaddingInPixels: 10,
  topPaddingInPixels: 10,
  bottomPaddingInPixels: 10,
  paddingBetweenFuriganaAndKanjiInPixels: 3,
  paddingBetweenLinesInPixels: 10,
  backgroundColor: 'white',
  textColor: 'black'
}
```

Text will wrap when it hits the maximum width.
