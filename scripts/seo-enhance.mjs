import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Authored locally after reviewing public SEO methodology. No third-party code executes.
const attr=(tag,name)=>tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`,'i'))?.[1]||'';
const decode=s=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
const text=s=>decode(s.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim());
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const json=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const linkTags=html=>[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>m[0]);
const canonical=html=>decode(attr(linkTags(html).find(tag=>attr(tag,'rel')==='canonical')||'','href'));
const alternates=html=>linkTags(html).filter(tag=>attr(tag,'rel')==='alternate'&&attr(tag,'hreflang'));
const schemas=html=>[...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m=>JSON.parse(m[1]));
const flat=value=>Array.isArray(value)?value.flatMap(flat):value?.['@graph']?flat(value['@graph']):[value];

async function pagesIn(dir,found=[]){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await pagesIn(p,found);else if(e.name.endsWith('.html'))found.push(p)}return found}
async function optionalJson(path){try{return JSON.parse(await readFile(path,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}}

export async function enhanceSite(root,{check=false}={}){
  const out=join(root,'dist'),map=await readFile(join(out,'sitemap.xml'),'utf8');
  const urls=[...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>decode(m[1]));
  if(!urls.length)throw new Error('No sitemap routes');
  const first=new URL(urls[0]),repoPath='/'+first.pathname.split('/')[1],origin=first.origin+repoPath;
  const fileFor=url=>join(out,new URL(url).pathname.slice(repoPath.length).replace(/^\//,''),'index.html');
  const pages=new Map();
  for(const url of urls){const file=fileFor(url),html=await readFile(file,'utf8');pages.set(url,{file,html,lang:attr(html.match(/<html\b[^>]*>/i)?.[0]||'','lang')})}
  const groups=new Map(),custom=await optionalJson(join(root,'scripts','seo-translations.json'));
  for(const url of urls){const suffix=new URL(url).pathname.slice(repoPath.length).split('/').slice(2).join('/');if(!groups.has(suffix))groups.set(suffix,[]);groups.get(suffix).push(url)}
  const groupFor=new Map();
  for(const members of groups.values())for(const url of members)groupFor.set(url,members);
  for(const members of custom?.translationGroups||[]){for(const url of members){if(!pages.has(url))throw new Error(`Translation missing: ${url}`);groupFor.set(url,members)}}
  let changed=0,articles=0,offersRemoved=0;
  if(!check){
    await writeFile(join(out,'assets','seo-layout.css'),'/* Preserve equal marketplace frames when flex direction becomes column. */\nbody{min-width:0}\n.store-row>.store-link,.store-row>.play-badge,.store-row>.store-button.disabled,.store-row>.store-disabled{flex:none}\n');
    for(const [url,page] of pages){
      let html=page.html;
      if(!html.includes(`${repoPath}/assets/seo-layout.css`))html=html.replace('</head>',`<link rel="stylesheet" href="${repoPath}/assets/seo-layout.css"></head>`);
      const members=groupFor.get(url),defaultUrl=members.find(u=>pages.get(u).lang===pages.get(urls[0]).lang)||members[0];
      html=html.replace(/<link\b[^>]*>/gi,tag=>attr(tag,'rel')==='alternate'&&attr(tag,'hreflang')?'':tag);
      const alternateHtml=members.map(u=>`<link rel="alternate" hreflang="${escape(pages.get(u).lang)}" href="${escape(u)}">`).join('')+`<link rel="alternate" hreflang="x-default" href="${escape(defaultUrl)}">`;
      html=html.replace(/<a\b[^>]*>/gi,tag=>{
        if(!attr(tag,'class').split(/\s+/).includes('language'))return tag;
        const current=attr(tag,'href');
        const targetLocale=current.startsWith(repoPath+'/')?current.slice(repoPath.length+1).split('/')[0]:'';
        const target=members.find(u=>new URL(u).pathname.split('/')[2]===targetLocale);
        return target?tag.replace(/href=["'][^"']*["']/,`href="${escape(new URL(target).pathname)}"`):tag;
      });
      const description=decode(attr((html.match(/<meta\b[^>]*>/gi)||[]).find(t=>attr(t,'name')==='description')||'','content'));
      const title=text(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]||'');
      for(const [name,value] of [['twitter:title',title],['twitter:description',description]])if(!html.includes(`name="${name}"`))html=html.replace('</head>',`<meta name="${name}" content="${escape(value)}"></head>`);
      const sourceAside=html.match(/<(?:aside|section)\b[^>]*class=["'][^"']*(?:official-source|sources)[^"']*["'][^>]*>([\s\S]*?)<\/(?:aside|section)>/i)?.[1]||'';
      const sources=[...new Set([...sourceAside.matchAll(/<a\b[^>]*>/gi)].map(m=>decode(attr(m[0],'href'))).filter(h=>/^https:\/\//.test(h)))];
      const h1=text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
      let isArticle=false;
      html=html.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,(_,open,body,close)=>{
        const value=JSON.parse(body);
        for(const item of flat(value)){
          if(item?.['@type']==='SoftwareApplication'){
            if(item.offers){delete item.offers;offersRemoved++}
            item['@id']=url+'#app';item.url=url;item.inLanguage=page.lang;
          }
          if(['Article','BlogPosting'].includes(item?.['@type'])){
            isArticle=true;item['@id']=url+'#article';item.url=url;item.inLanguage=page.lang;
            if(sources.length)item.citation=sources;
            for(const role of ['author','publisher'])if(item[role]?.name==='RushLabs')item[role]={...item[role],'@id':origin+'/#publisher',url:origin+'/'};
          }
        }
        return open+json(value)+close;
      });
      if(isArticle){
        articles++;
        const crumbNav=html.match(/<nav\b[^>]*class=["'][^"']*breadcrumbs[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1]||'';
        const crumbs=[...crumbNav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m=>({name:text(m[2]),item:new URL(decode(attr(m[1],'href')),url).href}));
        if(crumbs.length>=2&&!schemas(html).flatMap(flat).some(s=>s?.['@type']==='BreadcrumbList')){
          crumbs.push({name:h1,item:url});
          html=html.replace('</head>',`<script type="application/ld+json">${json({'@context':'https://schema.org','@type':'BreadcrumbList','@id':url+'#breadcrumbs',itemListElement:crumbs.map((c,i)=>({'@type':'ListItem',position:i+1,...c}))})}</script></head>`);
        }
      }
      // Preserve original artwork and layout. Prioritise the existing above-fold app screen.
      let prioritySet=false;
      html=html.replace(/<img\b[^>]*>/gi,tag=>{
        if(!/\/screenshots\//.test(attr(tag,'src')))return tag;
        if(!attr(tag,'decoding'))tag=tag.replace(/>$/,' decoding="async">');
        if(!prioritySet&&attr(tag,'loading')!=='lazy'){prioritySet=true;if(!attr(tag,'fetchpriority'))tag=tag.replace(/>$/,' fetchpriority="high">')}
        return tag;
      });
      html=html.replace('</head>',alternateHtml+'</head>');
      if(html!==page.html){await writeFile(page.file,html);changed++}
      page.html=html;
    }
    for(const file of await pagesIn(out))if(file.endsWith('/404.html')){
      let html=await readFile(file,'utf8');
      html=html.replace(/<link\b[^>]*>/gi,tag=>attr(tag,'rel')==='alternate'&&attr(tag,'hreflang')?'':tag);
      html=html.replace(/<meta\b[^>]*>/gi,tag=>attr(tag,'name')==='robots'?'':tag);
      html=html.replace(/<link\b[^>]*>/gi,tag=>attr(tag,'rel')==='canonical'?`<link rel="canonical" href="${origin}/404.html">`:tag);
      html=html.replace('</head>','<meta name="robots" content="noindex,follow"></head>');
      await writeFile(file,html);
    }
  }
  const errors=[];
  const titleSet=new Set();
  for(const [url,page] of pages){
    if(check)page.html=await readFile(page.file,'utf8');
    const html=page.html;
    if(canonical(html)!==url)errors.push(`${url}: canonical mismatch`);
    if((html.match(/<h1\b/gi)||[]).length!==1)errors.push(`${url}: expected one H1`);
    if((html.match(/<meta\b[^>]*>/gi)||[]).some(tag=>attr(tag,'name').toLowerCase()==='robots'&&/\bnoindex\b/i.test(attr(tag,'content'))))errors.push(`${url}: indexable route has noindex`);
    const title=html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]||'';
    const key=page.lang+':'+title;if(titleSet.has(key))errors.push(`${url}: duplicate same-language title`);titleSet.add(key);
    for(const tag of alternates(html)){
      const target=decode(attr(tag,'href'));
      if(!pages.has(target)){errors.push(`${url}: alternate missing ${target}`);continue}
      if(!(groupFor.get(url)||[]).includes(target))errors.push(`${url}: alternate is not the corresponding translation ${target}`);
      if(attr(tag,'hreflang')!=='x-default'&&!alternates(pages.get(target).html).some(t=>decode(attr(t,'href'))===url))errors.push(`${url}: alternate not reciprocal ${target}`);
    }
    for(const item of schemas(html).flatMap(flat)){
      if(item?.['@type']==='SoftwareApplication'&&item.offers)errors.push(`${url}: unverified offer`);
      if(['Article','BlogPosting'].includes(item?.['@type'])){
        if(!item['@id']||!item.citation?.length)errors.push(`${url}: missing article identity or source citation`);
        if(!schemas(html).flatMap(flat).some(s=>s?.['@type']==='BreadcrumbList'))errors.push(`${url}: missing breadcrumb schema`);
      }
    }
    for(const match of html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)){
      const href=decode(match[1]);if(/^(?:#|mailto:|tel:|data:|javascript:)/.test(href))continue;
      let u;try{u=new URL(href,url)}catch{errors.push(`${url}: invalid URL ${href}`);continue}
      if(u.origin!==first.origin||!u.pathname.startsWith(repoPath+'/'))continue;
      const file=resolve(out,u.pathname.slice(repoPath.length+1)+(u.pathname.endsWith('/')?'index.html':''));
      try{await access(file)}catch{errors.push(`${url}: missing local target ${href}`)}
    }
  }
  const errorPage=await readFile(join(out,'404.html'),'utf8');
  if(!/<meta\b[^>]*name="robots"[^>]*content="noindex,follow"/.test(errorPage))errors.push('404 missing noindex');
  if(alternates(errorPage).length)errors.push('404 has hreflang');
  if(errors.length)throw new Error(errors.join('\n'));
  return {routes:pages.size,articles,changed,offersRemoved,status:'passed'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=join(dirname(fileURLToPath(import.meta.url)),'..');
  console.log(JSON.stringify(await enhanceSite(root,{check:process.argv.includes('--check')})));
}
