// The Steez Mod Panel web page (served at /mod). Vanilla JS; all data inserted as text nodes.
export const PANEL_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Steez Mod Panel</title>
<style>
:root{--bg:#161616;--sunk:#111;--surface:#1c1c1c;--s2:#222;--s3:#2a2a2a;--line:#2b2b2b;--line2:#383838;--text:#e6e6e6;--t2:#a9a9a9;--t3:#6f6f6f;--accent:#d4d4d4;--ok:#7fb37f;--bad:#c9605a;color-scheme:dark}
*{box-sizing:border-box;border-radius:0}
html,body{margin:0;background:var(--bg);color:var(--text);font:13px/1.45 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
a{color:#f0f0f0}
.top{display:flex;align-items:center;gap:14px;height:46px;padding:0 18px;border-bottom:1px solid var(--line);background:#121212;position:sticky;top:0;z-index:5}
.brand{font-weight:800;letter-spacing:.28em;font-size:12px}
.top .grow{flex:1}
.wrap{max-width:1100px;margin:0 auto;padding:22px 20px 60px}
h1{font-size:22px;font-weight:600;margin:0 0 4px}
h3{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--t2);margin:0 0 12px;font-weight:600}
.sub{color:var(--t2)}
.panel{background:var(--surface);border:1px solid var(--line);padding:16px;margin-bottom:14px;overflow-x:auto}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.grow{flex:1}
button{font:inherit;font-size:12.5px;color:var(--text);background:var(--s2);border:1px solid var(--line2);padding:6px 13px;cursor:pointer;white-space:nowrap}
button:hover{background:var(--s3);border-color:#4a4a4a}
button.primary{background:var(--accent);border-color:var(--accent);color:#121212;font-weight:600}
button.primary:hover{background:#f2f2f2}
button.danger{color:#e09a95}button.danger:hover{border-color:var(--bad)}
button.sm{padding:3px 9px;font-size:11.5px}
button:disabled{opacity:.45;cursor:default}
input,select,textarea{font:inherit;color:var(--text);background:var(--sunk);border:1px solid var(--line2);padding:6px 9px;width:100%;outline:none}
input:focus,select:focus,textarea:focus{border-color:#6a6a6a}
textarea{min-height:80px;resize:vertical;font-family:Consolas,monospace;font-size:12px}
input[type=checkbox]{width:auto}
label.f{display:block;margin-bottom:10px}label.f>span{display:block;color:var(--t2);font-size:11px;margin-bottom:4px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;font-weight:600}
td.mono{font-family:Consolas,monospace;font-size:12px;max-width:460px;word-break:break-word}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin:18px 0 16px;flex-wrap:wrap}
.tabs button{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--t2);padding:8px 14px;margin-bottom:-1px}
.tabs button.on{color:var(--text);border-bottom-color:var(--accent)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;font-size:11px;border:1px solid var(--line2);color:var(--t2);background:var(--s2)}
.pill::before{content:'';width:5px;height:5px;background:currentColor}
.pill.ok{color:var(--ok);border-color:#3c4d3c}.pill.off{color:#e09a95;border-color:#4f3432}
.chan{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);background:var(--surface);margin-bottom:6px;cursor:pointer}
.chan:hover{background:var(--s2)}
.chan.offline{opacity:.5;cursor:default}
.empty{color:var(--t3);padding:20px;text-align:center;border:1px dashed var(--line2)}
.banner{padding:10px 14px;border:1px solid var(--line2);border-left:2px solid var(--accent);background:var(--s2);margin-bottom:14px}
.banner.bad{border-left-color:var(--bad)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
@media (max-width:820px){.grid2{grid-template-columns:1fr}}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;z-index:50}
.modal{background:var(--surface);border:1px solid var(--line2);padding:20px;width:min(640px,94vw);max-height:88vh;overflow-y:auto}
.toast{position:fixed;right:18px;bottom:18px;background:var(--s2);border:1px solid var(--line2);border-left:2px solid var(--accent);padding:10px 14px;z-index:99;max-width:420px}
.toast.err{border-left-color:var(--bad)}
.login{max-width:420px;margin:12vh auto;text-align:center}
.login .panel{padding:28px}
.muted{color:var(--t2)}.faint{color:var(--t3)}.small{font-size:11.5px}
.bar{height:6px;background:var(--s3)}.bar>i{display:block;height:100%;background:var(--accent)}
</style></head><body>
<div class="top"><span class="brand">STEEZ</span><span class="faint">Mod Panel</span><span class="grow"></span><span id="who" class="faint small"></span><button class="sm" id="logout" style="display:none">Log out</button></div>
<div class="wrap" id="app"></div>
<script>
const CLIENT_ID='__CLIENT_ID__';
const $=(s)=>document.querySelector(s);
function h(tag,attrs,...kids){const el=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(v==null||v===false)continue;if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else if(k==='class')el.className=v;else if(k==='value')el.value=v;else if(k==='checked')el.checked=!!v;else el.setAttribute(k,v===true?'':v)}for(const kid of kids.flat(Infinity)){if(kid==null||kid===false)continue;el.append(kid instanceof Node?kid:document.createTextNode(String(kid)))}return el}
const btn=(t,fn,cls='')=>h('button',{class:cls,onclick:fn},t);
const panel=(title,...kids)=>h('div',{class:'panel'},title?h('h3',{},title):null,...kids);
function toast(m,err){const t=h('div',{class:'toast'+(err?' err':'')},m);document.body.append(t);setTimeout(()=>t.remove(),err?6000:2500)}
let session=localStorage.getItem('steezModSession')||'';
let channels=[],current=null,tab=null;

async function api(method,path,body){
  const r=await fetch(path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+session},body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));
  if(r.status===401){logout();throw new Error('Session expired — log in again')}
  if(!r.ok){throw new Error(j.error==='offline'?'Steez is offline on the streamer’s PC.':(j.error||('Error '+r.status)))}
  return j;
}
async function call(action,args){try{const r=await api('POST','/mod/api/call',{channelId:current.id,action,args});return r.result}catch(e){toast(e.message,true);throw e}}
function logout(){localStorage.removeItem('steezModSession');session='';current=null;render()}
$('#logout').onclick=logout;

function loginUrl(){const state=Math.random().toString(36).slice(2);sessionStorage.setItem('steezState',state);const p=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:location.origin+'/mod',response_type:'token',scope:'user:read:moderated_channels',state});return 'https://id.twitch.tv/oauth2/authorize?'+p}

async function boot(){
  const hp=new URLSearchParams(location.hash.slice(1));
  if(hp.get('access_token')){
    history.replaceState(null,'',location.pathname);
    if(hp.get('state')!==sessionStorage.getItem('steezState'))return toast('Login check failed — try again',true),render();
    try{const r=await fetch('/mod/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:hp.get('access_token')})});const j=await r.json();if(!r.ok)throw new Error(j.error);session=j.session;localStorage.setItem('steezModSession',session)}catch(e){toast(e.message,true)}
  } else if(hp.get('error')){history.replaceState(null,'',location.pathname);toast('Twitch login was cancelled',true)}
  render();
}

async function render(){
  const app=$('#app');app.replaceChildren();
  $('#logout').style.display=session?'':'none';
  if(!session){$('#who').textContent='';app.append(h('div',{class:'login'},panel(null,h('div',{class:'brand',style:'margin-bottom:14px'},'STEEZ'),h('h1',{},'Mod Panel'),h('p',{class:'muted'},'Manage the bot for channels you moderate. Log in with your own Twitch account.'),h('a',{href:loginUrl()},btn('Log in with Twitch',null,'primary')))));return}
  if(!current){
    app.append(h('h1',{},'Your channels'),h('div',{class:'sub',style:'margin-bottom:16px'},'Channels where you are a moderator. Steez must be open on the streamer’s PC.'));
    const box=h('div',{},h('div',{class:'faint'},'Loading…'));app.append(box);
    try{
      const j=await api('GET','/mod/api/channels');channels=j.channels;$('#who').textContent=j.user.login;
      const sorted=[...channels].sort((a,b)=>b.online-a.online);
      box.replaceChildren(...(sorted.length?sorted.map(c=>h('div',{class:'chan'+(c.online?'':' offline'),onclick:()=>{if(!c.online)return;current=c;tab=null;render()}},h('b',{class:'grow'},(c.info&&c.info.name)||c.name,c.own?h('span',{class:'faint small'},'  (your channel)'):null),h('span',{class:'pill '+(c.online?'ok':'off')},c.online?'Steez online':'Steez offline'))):[h('div',{class:'empty'},'You are not a moderator of any channel yet.')]));
      const online=sorted.filter(c=>c.online);
      if(online.length===1&&!sessionStorage.getItem('picked')){sessionStorage.setItem('picked','1');current=online[0];render()}
    }catch(e){box.replaceChildren(h('div',{class:'banner bad'},e.message))}
    return;
  }
  const perms=(current.info&&current.info.permissions)||{};
  const TABS=[['commands','Commands'],['timers','Timers'],['quotes','Quotes'],['giveaways','Giveaways'],['polls','Polls & Bets'],['songs','Song requests'],['queue','Viewer queue'],['points','Points'],['moderation','Moderation']].filter(([k])=>perms[k]);
  if(!tab||!TABS.find(t=>t[0]===tab))tab=TABS[0]&&TABS[0][0];
  app.append(h('div',{class:'row'},h('div',{class:'grow'},h('h1',{},(current.info&&current.info.name)||current.name),h('div',{class:'sub'},'Changes apply instantly and are logged in the streamer’s Steez.')),channels.filter(c=>c.online).length>1?btn('Switch channel',()=>{current=null;render()}):null));
  if(!TABS.length){app.append(h('div',{class:'banner'},'The streamer hasn’t allowed mods to change anything yet.'));return}
  app.append(h('div',{class:'tabs'},TABS.map(([k,l])=>h('button',{class:tab===k?'on':'',onclick:()=>{tab=k;render()}},l))));
  const body=h('div',{},h('div',{class:'faint'},'Loading…'));app.append(body);
  try{await VIEWS[tab](body)}catch(e){body.replaceChildren(h('div',{class:'banner bad'},e.message))}
}

function modal(title,content,onSave){const bg=h('div',{class:'modal-bg'});const close=()=>bg.remove();bg.addEventListener('mousedown',e=>e.target===bg&&close());bg.append(h('div',{class:'modal'},h('h3',{},title),content,h('div',{class:'row',style:'margin-top:12px'},btn('Save',async()=>{try{await onSave();close()}catch{}},'primary'),btn('Cancel',close))));document.body.append(bg)}
const field=(label,input)=>h('label',{class:'f'},h('span',{},label),input);

const VIEWS={
  async commands(el){
    const d=await call('commands.list');
    const levels=d.levels;
    const edit=(name,c)=>{c=Object.assign({response:'',level:'everyone',cooldown:5,userCooldown:0,enabled:true},c||{});
      const n=h('input',{value:name||'',placeholder:'e.g. discord'}),r=h('textarea',{},c.response),lv=h('select',{},levels.map(l=>h('option',{value:l,selected:l===c.level},l))),cd=h('input',{type:'number',value:c.cooldown||0}),ucd=h('input',{type:'number',value:c.userCooldown||0}),en=h('input',{type:'checkbox',checked:c.enabled!==false});
      modal(name?'Edit !'+name:'New command',h('div',{},field('Command name',n),field('Response — variables like \x24{user} \x24{touser} \x24{count} \x24{random.1-100} work',r),h('div',{class:'grid2'},field('Who can use it',lv),h('div',{},field('Global cooldown (s)',cd),field('Per-user cooldown (s)',ucd))),h('label',{class:'row'},en,'Enabled')),async()=>{await call('commands.save',{name:n.value,oldName:name||null,def:{response:r.value,level:lv.value,cooldown:+cd.value,userCooldown:+ucd.value,enabled:en.checked}});toast('Saved');render()})};
    const names=Object.keys(d.custom).sort();
    el.replaceChildren(panel('Custom commands',h('div',{class:'row',style:'margin-bottom:10px'},btn('+ New command',()=>edit(),'primary')),names.length?h('table',{},h('tr',{},['Command','Response','Level','Cooldown','On',''].map(t=>h('th',{},t))),names.map(n=>{const c=d.custom[n];return h('tr',{},h('td',{},h('b',{},'!'+n)),h('td',{class:'mono'},c.response),h('td',{},c.level||'everyone'),h('td',{},(c.cooldown||0)+'s / '+(c.userCooldown||0)+'s'),h('td',{},h('input',{type:'checkbox',checked:c.enabled!==false,onchange:async e=>{await call('commands.save',{name:n,oldName:n,def:Object.assign({},c,{enabled:e.target.checked})});toast('Saved')}})),h('td',{},h('div',{class:'row'},btn('Edit',()=>edit(n,c),'sm'),btn('Delete',async()=>{if(!confirm('Delete !'+n+'?'))return;await call('commands.delete',{name:n});toast('Deleted');render()},'sm danger'))))})):h('div',{class:'empty'},'No custom commands yet.')),
      panel('Built-in commands',h('table',{},h('tr',{},['Command','Description','Level','Cooldown (s)','On'].map(t=>h('th',{},t))),d.builtins.map(b=>h('tr',{},h('td',{},h('b',{},'!'+b.name)),h('td',{class:'small muted'},b.description),h('td',{},h('select',{onchange:async e=>{await call('commands.builtin',{name:b.name,patch:{level:e.target.value}});toast('Saved')}},levels.map(l=>h('option',{value:l,selected:l===b.level},l)))),h('td',{},h('input',{type:'number',value:b.cooldown,style:'width:80px',onchange:async e=>{await call('commands.builtin',{name:b.name,patch:{cooldown:+e.target.value}});toast('Saved')}})),h('td',{},h('input',{type:'checkbox',checked:b.enabled,onchange:async e=>{await call('commands.builtin',{name:b.name,patch:{enabled:e.target.checked}});toast('Saved')}})))))));
  },
  async timers(el){
    const list=await call('timers.list');
    const edit=(t)=>{t=Object.assign({name:'New timer',enabled:true,intervalMinutes:15,minLines:5,onlineOnly:true,messages:[]},t||{});
      const n=h('input',{value:t.name}),iv=h('input',{type:'number',value:t.intervalMinutes}),ml=h('input',{type:'number',value:t.minLines}),m=h('textarea',{},(t.messages||[]).join('\n')),en=h('input',{type:'checkbox',checked:t.enabled});
      modal(t.id?'Edit timer':'New timer',h('div',{},field('Name',n),h('div',{class:'grid2'},field('Every (minutes)',iv),field('Only if this many chat lines since',ml)),field('Messages (one per line, rotates)',m),h('label',{class:'row'},en,'Enabled')),async()=>{await call('timers.save',{timer:Object.assign({},t,{name:n.value,intervalMinutes:+iv.value,minLines:+ml.value,enabled:en.checked,messages:m.value.split('\n').map(s=>s.trim()).filter(Boolean)})});toast('Saved');render()})};
    el.replaceChildren(panel('Timers',h('div',{class:'row',style:'margin-bottom:10px'},btn('+ New timer',()=>edit(),'primary')),list.length?h('table',{},h('tr',{},['Timer','Every','Messages','On',''].map(t=>h('th',{},t))),list.map(t=>h('tr',{},h('td',{},h('b',{},t.name)),h('td',{},t.intervalMinutes+' min'),h('td',{class:'small muted'},(t.messages||[]).length+' message(s)'),h('td',{},t.enabled?'Yes':'No'),h('td',{},h('div',{class:'row'},btn('Edit',()=>edit(t),'sm'),btn('Delete',async()=>{if(!confirm('Delete timer?'))return;await call('timers.delete',{id:t.id});render()},'sm danger')))))):h('div',{class:'empty'},'No timers.')));
  },
  async quotes(el){
    const list=await call('quotes.list');const t=h('input',{placeholder:'Quote text'});
    el.replaceChildren(panel('Add a quote',h('div',{class:'row'},t,btn('Add',async()=>{if(!t.value.trim())return;await call('quotes.add',{text:t.value});toast('Added');render()},'primary'))),panel('Quotes',list.length?h('table',{},list.slice().reverse().map(q=>h('tr',{},h('td',{},'#'+q.id),h('td',{},q.text),h('td',{class:'faint small'},q.game||''),h('td',{},btn('Delete',async()=>{if(!confirm('Delete quote #'+q.id+'?'))return;await call('quotes.delete',{id:q.id});render()},'sm danger'))))):h('div',{class:'empty'},'No quotes yet.')));
  },
  async giveaways(el){
    const s=await call('giveaway.state');const r=s&&s.raffle;
    const title=h('input',{value:'Giveaway'}),kw=h('input',{value:'!enter'}),cost=h('input',{type:'number',value:0}),sl=h('input',{type:'number',value:2});
    el.replaceChildren(h('div',{class:'grid2'},panel('Start a giveaway',field('Title',title),field('Keyword',kw),field('Ticket cost (points, 0 = free)',cost),field('Sub luck (×)',sl),btn('Start',async()=>{await call('giveaway.start',{title:title.value,keyword:kw.value,ticketCost:+cost.value,subLuck:+sl.value});toast('Started');render()},'primary')),
      panel('Current giveaway',r?h('div',{},h('div',{class:'row'},h('b',{},r.title),h('span',{class:'pill '+(r.open?'ok':'')},r.open?'Open':'Closed'),h('span',{class:'muted'},r.entries.length+' entrants')),h('div',{class:'row',style:'margin-top:12px'},btn('Close entries',async()=>{await call('giveaway.stop');render()}),btn('Draw winner',async()=>{const w=await call('giveaway.draw');toast('Winner: '+(w&&w.display));render()},'primary'),btn('Cancel',async()=>{if(!confirm('Cancel the giveaway?'))return;await call('giveaway.cancel');render()},'danger'))):h('div',{class:'empty'},'No giveaway running.'),s&&s.lastWinner?h('p',{class:'muted'},'Last winner: '+s.lastWinner.display):null)));
  },
  async polls(el){
    const s=await call('polls.state');const p=s.poll,b=s.bets;
    const pq=h('input',{placeholder:'Question'}),po=h('textarea',{placeholder:'One option per line'}),bq=h('input',{placeholder:'What will happen?'}),bo=h('textarea',{placeholder:'One outcome per line'});
    const lines=(t)=>t.value.split('\n').map(x=>x.trim()).filter(Boolean);
    el.replaceChildren(h('div',{class:'grid2'},
      h('div',{},panel('Chat poll',p?h('div',{},h('b',{},p.question),p.options.map((o,i)=>h('div',{style:'margin:8px 0'},h('div',{class:'row'},(i+1)+'. '+o.text,h('span',{class:'grow'}),String(o.votes)),h('div',{class:'bar'},h('i',{style:'width:'+(p.total?o.votes/p.total*100:0)+'%'})))),p.open?btn('End poll',async()=>{await call('polls.end');render()},'primary'):null):h('div',{},field('Question',pq),field('Options',po),btn('Start poll',async()=>{await call('polls.start',{question:pq.value,options:lines(po)});render()},'primary')))),
      h('div',{},panel('Bets',b?h('div',{},h('b',{},b.question),b.options.map((o,i)=>h('div',{class:'row',style:'margin:8px 0'},(i+1)+'. '+o.text,h('span',{class:'muted'},o.pool+' from '+o.bettors),h('span',{class:'grow'}),btn('Winner',async()=>{if(!confirm('Pay out "'+o.text+'"?'))return;await call('bets.resolve',{option:i});render()},'sm primary'))),h('div',{class:'row'},b.open?btn('Lock bets',async()=>{await call('bets.lock');render()}):null,btn('Refund all',async()=>{if(!confirm('Refund everyone?'))return;await call('bets.refund');render()},'danger'))):h('div',{},field('Question',bq),field('Outcomes',bo),btn('Open bets',async()=>{await call('bets.open',{question:bq.value,options:lines(bo)});render()},'primary'))))));
  },
  async songs(el){
    const cmd=async(c,msg)=>{await call('songs.command',{cmd:c});toast(msg)};
    el.replaceChildren(panel('Song requests',h('p',{class:'muted'},'Control the streamer’s music player.'),h('div',{class:'row'},btn('Skip song',()=>cmd('skip','Skipped'),'primary'),btn('Pause',()=>cmd('pause','Paused')),btn('Resume',()=>cmd('resume','Resumed')),btn('Clear request queue',async()=>{if(!confirm('Clear all pending song requests?'))return;await cmd('clearqueue','Cleared')},'danger'))));
  },
  async queue(el){
    const s=await call('queue.state');
    const row=(e,i,list)=>h('tr',{},h('td',{},i+1),h('td',{},e.display||e.name||e.login),h('td',{},list==='queue'?btn('Remove',async()=>{await call('queue.remove',{id:e.id});render()},'sm danger'):''));
    el.replaceChildren(h('div',{class:'row',style:'margin-bottom:12px'},h('span',{class:'pill '+(s.open?'ok':'off')},s.open?'Queue open':'Queue closed'),btn(s.open?'Close queue':'Open queue',async()=>{await call('queue.open',{open:!s.open});render()}),btn('Next game',async()=>{await call('queue.next');render()},'primary'),btn('Refresh',()=>render())),
      h('div',{class:'grid2'},panel('Party',s.party.length?h('table',{},s.party.map((e,i)=>row(e,i,'party'))):h('div',{class:'empty'},'Empty')),panel('Queue ('+s.queue.length+')',s.queue.length?h('table',{},s.queue.map((e,i)=>row(e,i,'queue'))):h('div',{class:'empty'},'Nobody waiting'))));
  },
  async points(el){
    const u=h('input',{placeholder:'username'}),a=h('input',{type:'number',placeholder:'amount'}),out=h('div',{class:'muted',style:'margin-top:10px'});
    const go=async(sign)=>{const r=await call('points.adjust',{login:u.value,amount:sign*Math.abs(+a.value||0)});out.textContent=r.login+' now has '+r.points.toLocaleString()+' '+r.currency;};
    el.replaceChildren(panel('Give or take points',h('div',{class:'row'},u,a,btn('Give',()=>go(1),'primary'),btn('Take',()=>go(-1),'danger'),btn('Check',async()=>{const r=await call('points.get',{login:u.value});out.textContent=r.login+' has '+r.points.toLocaleString()+' '+r.currency})),out));
  },
  async moderation(el){
    const s=await call('mod.state');
    el.replaceChildren(panel('Shield mode',h('p',{class:'muted'},'Followers-only, slow mode and emote-only for a few minutes.'),h('div',{class:'row'},h('span',{class:'pill '+(s.shield&&s.shield.on?'off':'')},s.shield&&s.shield.on?'Active':'Inactive'),btn('Activate',async()=>{await call('mod.shield',{on:true});toast('Shield on');render()},'primary'),btn('Deactivate',async()=>{await call('mod.shield',{on:false});toast('Shield off');render()}))),
      panel('Recent automatic moderation',s.log.length?h('table',{},h('tr',{},['When','User','Filter','Action'].map(t=>h('th',{},t))),s.log.map(r=>h('tr',{},h('td',{class:'small faint'},new Date(r.t).toLocaleTimeString()),h('td',{},r.user),h('td',{},r.filter),h('td',{},r.action)))):h('div',{class:'empty'},'Nothing yet.')));
  },
};
boot();
</script></body></html>`;
