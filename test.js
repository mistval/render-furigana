const renderFurigana = require('./index.js');
const fs = require('fs');
const kanjiFont = '40px IPAMincho';
const furiganaFont = '20px IPAMincho';

renderFurigana('青と赤', kanjiFont, furiganaFont).then(pngBuffer => {
  fs.writeFileSync('./output.png', pngBuffer);
});