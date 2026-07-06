const DB_URL = 'https://final-fysc-default-rtdb.asia-southeast1.firebasedatabase.app/.json';
const grid = document.getElementById('grid');
const errorEl = document.getElementById('error');

function fmtNumber(n){
  if(n==null) return '0';
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");
}

function createCell(rank, item){
  const el = document.createElement('div');
  el.className = 'cell';
  const rankEl = document.createElement('div'); rankEl.className='rank'; rankEl.textContent = `#${rank}`;
  const nameEl = document.createElement('div'); nameEl.className='name'; nameEl.textContent = item.name || item.displayName || 'Unknown';
  const subsEl = document.createElement('div'); subsEl.className='subs';
  const subs = item.subscriberCount ?? item.subs ?? item.subscribers ?? item.sub_count ?? item.sub_count || 0;
  subsEl.textContent = `${fmtNumber(subs)} subscribers`;
  el.appendChild(rankEl);
  el.appendChild(nameEl);
  el.appendChild(subsEl);
  return el;
}

function showError(msg){
  errorEl.hidden = false; errorEl.textContent = msg;
}

async function load(){
  try{
    const res = await fetch(DB_URL);
    if(!res.ok) throw new Error('Network response not ok: '+res.status);
    const data = await res.json();
    if(!data || typeof data !== 'object') throw new Error('Unexpected data format');

    // Transform entries into array
    const items = Object.values(data).map(v=>v||{});

    // Heuristic to find subscriber count value inside object
    const normalized = items.map(it=>{
      const keys = Object.keys(it);
      let subs = null;
      for(const k of ['subscriberCount','subscribers','subs','sub_count','subscriber_count','subscriber']){
        if(k in it){ subs = Number(it[k]); break; }
      }
      // try to find numeric child value
      if(subs==null){
        for(const k of keys){ if(typeof it[k]==='number'){ subs = it[k]; break; }}
      }
      return { ...it, subscriberCount: subs ?? 0 };
    });

    normalized.sort((a,b)=>Number(b.subscriberCount||0)-Number(a.subscriberCount||0));
    const top = normalized.slice(0,50);

    // clear grid and render 50 cells (fill blanks if fewer)
    grid.innerHTML='';
    for(let i=0;i<50;i++){
      const item = top[i] || { name: '—', subscriberCount: 0 };
      grid.appendChild(createCell(i+1,item));
    }

  }catch(err){
    console.error(err);
    showError('Failed to load leaderboard: '+err.message);
  }
}

load();
