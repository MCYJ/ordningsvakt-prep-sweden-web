import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Give changed CSS a new URL so browsers cannot reuse the previous Pages stylesheet.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=join(root,'dist');
async function htmlFiles(dir){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())files.push(...await htmlFiles(p));else if(e.name.endsWith('.html'))files.push(p)}return files}
const versions=[];
for(const name of ['styles.css','seo-layout.css']){
  const data=await readFile(join(out,'assets',name));
  const digest=createHash('sha256').update(data).digest('hex').slice(0,12);
  const version=name.replace('.css','-'+digest+'.css');
  await writeFile(join(out,'assets',version),data);
  versions.push([name,version]);
}
for(const file of await htmlFiles(out)){
  let html=await readFile(file,'utf8');
  for(const [name,version] of versions)html=html.replaceAll('/assets/'+name+'"','/assets/'+version+'"');
  await writeFile(file,html);
}
console.log(JSON.stringify({versionedStyles:versions.map(([,name])=>name)}));
