import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const code=['core.js','adapter.js','tests/browser.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
const html=fs.readFileSync(path.join(root,'tests/browser.html'),'utf8').replace('<script type="module" src="browser.js"></script>',`<script type="module">${code}</script>`);
fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.writeFileSync(path.join(root,'dist/browser-fixture.html'),html);
console.log('Created dist/browser-fixture.html from current production sources.');
