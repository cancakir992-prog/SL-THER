(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const state = {
    token: localStorage.getItem("arena-token"),
    player: null, owned: [], skins: [], mode: "bots", socket: null, room: "",
    world: { width: 3600, height: 2400 }, snapshot: null, me: null, pointer: null,
    boosting: false, sound: localStorage.getItem("arena-sound") !== "off", audio: null,
    sensitivity: Math.min(10,Math.max(1,Number(localStorage.getItem("arena-sensitivity"))||6)), lastScore: 0,
    filter: "Tümü", toastTimer: null, leaderboard: null, boardPeriod: "best"
  };
  const views = ["menu-view", "shop-view", "history-view", "game-view"];
  const categories = ["Tümü", "Klasik", "Neon", "Gradyan", "Ateş", "Buz", "Uzay", "Gökkuşağı", "Metalik", "Doğa", "Element", "Kamuflaj", "Çizgili", "Geometrik", "Retro", "Özel", "Animasyonlu"];
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
  function showToast(message) {
    const toast=$("#toast");
    toast.textContent=message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer=setTimeout(()=>toast.classList.remove("show"),2600);
  }
  function playCue() {
    if (!state.sound) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    state.audio ||= new AudioContext();
    if (state.audio.state === "suspended") state.audio.resume();
    const oscillator = state.audio.createOscillator();
    const gain = state.audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(620, state.audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(920, state.audio.currentTime + 0.07);
    gain.gain.setValueAtTime(0.055, state.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, state.audio.currentTime + 0.09);
    oscillator.connect(gain);gain.connect(state.audio.destination);
    oscillator.start();oscillator.stop(state.audio.currentTime + 0.09);
  }
  async function api(url, options={}) {
    const headers={ "Content-Type":"application/json", ...(options.headers||{}) };
    if(state.token) headers.Authorization=`Bearer ${state.token}`;
    const response=await fetch(url,{...options,headers});
    const payload=await response.json().catch(()=>({error:"Sunucudan geçersiz yanıt alındı."}));
    if(!response.ok) throw new Error(payload.error||"İstek başarısız oldu.");
    return payload;
  }
  async function resetPlayerScores() {
    if($("#player-reset-confirm").value.trim().toUpperCase()!=="RESET") {
      $("#player-reset-status").textContent="Onay alanına reset yazmalısın.";
      return;
    }
    const button=$("#player-reset-submit");
    button.disabled=true;
    $("#player-reset-status").textContent="Oyuncu bilgilerin sıfırlanıyor…";
    try {
      await api("/api/me/reset-scores",{
        method:"POST",
        body:JSON.stringify({confirmation:"RESET"})
      });
      $("#player-reset-confirm").value="";
      $("#player-reset-status").textContent="Oyuncu bilgilerin sıfırlandı. Hesabın ve skinlerin korundu.";
      await Promise.all([refreshProfile(),loadLeaderboard()]);
      showToast("Oyuncu bilgilerin sıfırlandı.");
    } catch(error) {
      $("#player-reset-status").textContent=error.message;
    } finally {
      button.disabled=false;
    }
  }
  async function refreshProfile() {
    if(!state.token) return;
    try {
      const data=await api("/api/me");
      state.player=data.player;
      state.owned=data.skins;
      updateProfile();
    } catch(error) {
      if(error.message==="Oturum geçersiz."||error.message==="Oturum gerekli.") {
        state.token=null;state.player=null;state.owned=[];
        localStorage.removeItem("arena-token");
        updateProfile();
      } else showToast(error.message);
    }
  }
  function updateProfile() {
    const player=state.player;
    $("#wallet-points").textContent=player?.points??0;
    $("#shop-points").textContent=player?.points??0;
    $("#stat-points").textContent=player?.points??0;
    $("#stat-games").textContent=player?.games??0;
    $("#stat-best").textContent=player?.best_score??0;
    $("#profile-name").textContent=player?.username||"Misafir oyuncu";
    $("#profile-tag").textContent=player?`${state.owned.length} skin koleksiyonda`:"Arenaya katıl ve başla";
    $("#profile-avatar").textContent=player?.username?.[0]?.toUpperCase()||"?";
    $("#profile-snake").textContent=player?"✦":"?";
  }
  async function ensurePlayer() {
    if(state.token) {
      try {
        const me=await api("/api/me");
        state.player=me.player;state.owned=me.skins;updateProfile();
        return;
      } catch(error) {
        if(error.message!=="Oturum geçersiz."&&error.message!=="Oturum gerekli.") throw error;
      }
    }
    const username=$("#username").value.trim();
    if(!/^[\p{L}\p{N}_ -]{2,18}$/u.test(username)) throw new Error("İsim 2-18 karakter olmalı.");
    const data=await api("/api/guest",{method:"POST",body:JSON.stringify({username})});
    state.token=data.token;state.player=data.player;
    localStorage.setItem("arena-token",state.token);
    await refreshProfile();
  }
  function showView(id) {
    for(const view of views) $("#"+view).classList.toggle("hidden",view!==id);
    if(id==="menu-view") loadLeaderboard();
    if(id==="shop-view") loadShop();
  }
  async function loadLeaderboard() {
    try {
      const data=await api("/api/leaderboard");
      state.leaderboard=data;
      renderLeaderboard();
      $("#recent-list").innerHTML=data.recent.length?data.recent.map(item=>`<div class="recent-row"><span class="mode-icon">${item.mode==="bots"?"✳":"⌁"}</span><b>${escapeHtml(item.username)}</b><span class="rank-score">${item.score}</span></div>`).join(""):'<div class="empty-state">Maç sonuçları burada görünecek.</div>';
      $("#online-count").textContent=data.online??state.snapshot?.online??"—";
    } catch(error) { showToast(error.message); }
  }
  function renderLeaderboard() {
    if(!state.leaderboard)return;
    const data=state.leaderboard;
    const list=data[state.boardPeriod]||[];
    const scoreKey=state.boardPeriod==="players"?"points":"score";
    const heading={best:"En iyi skorlar",daily:"Günlük liderler",weekly:"Haftalık liderler",players:"Genel sıralama"}[state.boardPeriod];
    $(".leaderboard-panel h3").textContent=heading;
    $("#best-list").innerHTML=list.length?list.map((item,i)=>`<div class="rank-row"><span class="rank-number">${String(i+1).padStart(2,"0")}</span><b>${escapeHtml(item.username)}</b><span class="rank-score">${item[scoreKey]} <small>puan</small></span></div>`).join(""):'<div class="empty-state">Bu sıralamada henüz sonuç yok.</div>';
    let tabs=$(".board-tabs");
    if(!tabs) {
      tabs=document.createElement("div");tabs.className="board-tabs";
      tabs.style.cssText="display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end";
      $(".leaderboard-panel .panel-heading").append(tabs);
    }
    tabs.innerHTML=[["best","En iyi"],["daily","Günlük"],["weekly","Haftalık"],["players","Puan"]].map(([key,label])=>
      `<button type="button" data-board="${key}" style="border:1px solid ${state.boardPeriod===key?"#61dfbd66":"#ffffff12"};border-radius:8px;background:${state.boardPeriod===key?"#5de0b81a":"#ffffff05"};color:${state.boardPeriod===key?"#9af0d4":"#9294a7"};padding:5px 7px;font:8px 'DM Sans';cursor:pointer">${label}</button>`
    ).join("");
    tabs.querySelectorAll("[data-board]").forEach(button=>button.addEventListener("click",()=>{
      state.boardPeriod=button.dataset.board;renderLeaderboard();
    }));
  }
  function renderFilters() {
    $("#skin-filters").innerHTML=categories.map(category=>`<button class="filter-chip ${state.filter===category?"active":""}" data-filter="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("");
    $("#skin-filters").querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{
      state.filter=button.dataset.filter;renderFilters();renderSkins();
    }));
  }
  async function loadShop() {
    try {
      const [skins]=await Promise.all([api("/api/skins"),refreshProfile()]);
      state.skins=skins;renderFilters();renderSkins();
      $("#shop-points").textContent=state.player?.points??0;
    } catch(error) { showToast(error.message); }
  }
  function renderSkins() {
    const list=state.filter==="Tümü"?state.skins:state.skins.filter(skin=>skin.category===state.filter);
    $("#skin-grid").innerHTML=list.map(skin=>{
      const owned=state.owned.some(item=>item.id===skin.id);
      const equipped=state.player?.equipped_skin===skin.id;
      const label=equipped?"Kullanılıyor":owned?"Kullan":"Satın al · "+skin.price+" ✦";
      return `<article class="skin-card"><div class="skin-preview" style="--color:${escapeHtml(skin.color)};--accent:${escapeHtml(skin.accent)}"></div><h3>${escapeHtml(skin.name)}</h3><div class="skin-meta">${escapeHtml(skin.rarity)} · ${escapeHtml(skin.category)}</div><button class="skin-action ${owned?"owned":""}" data-skin="${escapeHtml(skin.id)}" ${equipped?"disabled":""}>${label}</button></article>`;
    }).join("");
    $("#skin-grid").querySelectorAll("[data-skin]").forEach(button=>button.addEventListener("click",()=>handleSkin(button.dataset.skin)));
  }
  async function handleSkin(skinId) {
    const owned=state.owned.some(item=>item.id===skinId);
    try {
      await api(owned?"/api/shop/equip":"/api/shop/buy",{method:"POST",body:JSON.stringify({skinId})});
      await refreshProfile();renderSkins();showToast(owned?"Skin seçildi.":"Skin koleksiyonuna eklendi!");
    } catch(error) { showToast(error.message); }
  }
  async function openHistory() {
    try {
      const games=await api("/api/history");
      $("#history-list").innerHTML=games.length?games.map(game=>`<div class="history-item"><span>${game.mode==="bots"?"Bot maçı":"Çevrim içi"} · ${new Date(game.created_at+"Z").toLocaleString("tr-TR")}</span><span>Skor <b>${game.score}</b> · +${game.reward} ✦</span></div>`).join(""):'<div class="empty-state">Henüz tamamlanmış maçın yok.</div>';
      showView("history-view");
    } catch(error) { showToast(error.message); }
  }
  function setMode(mode) {
    state.mode=mode;
    document.querySelectorAll(".mode-button").forEach(button=>button.classList.toggle("selected",button.dataset.mode===mode));
    $("#room-entry").classList.toggle("hidden",mode!=="online");
  }
  function connectGame(mode) {
    if(typeof window.io!=="function") throw new Error("Oyun bağlantı kütüphanesi yüklenemedi.");
    if(state.socket) { state.socket.disconnect();state.socket=null; }
    const socket=window.io({auth:{token:state.token},reconnection:true,reconnectionAttempts:8,timeout:10000});
    socket.__arenaJoined=false;
    state.socket=socket;
    setupSocket(socket);
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error("Sunucuya bağlanılamadı. Yeniden deneyin.")),12000);
      socket.once("connect",()=>{
        socket.emit("join",{mode,room:$("#room-code").value.trim()},ack=>{
          clearTimeout(timeout);
          if(ack?.error){socket.disconnect();reject(new Error(ack.error));return;}
          state.room=ack.room;state.world=ack.world;state.snapshot=null;
          socket.__arenaJoined=true;
          $("#room-label").textContent=ack.room;
          $("#game-over").classList.add("hidden");
          showView("game-view");
          resolve();
        });
      });
      socket.once("connect_error",error=>{clearTimeout(timeout);reject(new Error(error.message||"Bağlantı kurulamadı."));});
    });
  }
  async function startGame(mode=state.mode) {
    try {
      if(!$("#username").value.trim()&&state.player)$("#username").value=state.player.username.split("#")[0];
      await ensurePlayer();
      const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(state.sound&&AudioContext){state.audio ||= new AudioContext();if(state.audio.state==="suspended")await state.audio.resume();}
      state.lastScore=0;
      await connectGame(mode);
      $("#online-count").textContent="…";
    } catch(error) { showToast(error.message); }
  }
  function timeText(seconds) { return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`; }
  function setupSocket(socket) {
    socket.on("state",snapshot=>{
      state.snapshot=snapshot;
      const current=snapshot.snakes.find(snake=>snake.id===socket.id);
      if(current){
        if(current.score>state.lastScore)playCue();
        state.lastScore=current.score;
        state.me=current;
      }
      $("#online-count").textContent=snapshot.online;
      $("#live-score").textContent=state.me?.score||0;
      const rows=[...snapshot.snakes].sort((a,b)=>b.score-a.score).slice(0,6);
      $("#game-rankings").innerHTML=rows.map((snake,i)=>`<div class="side-row"><span>${i+1}. ${escapeHtml(snake.username)}</span><b>${snake.score}</b></div>`).join("");
      drawGame();
    });
    socket.on("onlineCount",count=>$("#online-count").textContent=count);
    socket.on("playerScoresReset",()=>{
      state.lastScore=0;
      showToast("Oyuncu bilgilerin sıfırlandı. Bu maç sıfır skordan devam ediyor.");
      refreshProfile();
      loadLeaderboard();
    });
    socket.on("gameOver",result=>{
      $("#final-score").textContent=result.score;
      $("#final-rank").textContent=result.rank?`${result.rank}.`:"—";
      $("#final-duration").textContent=timeText(result.duration);
      $("#final-reward").textContent=result.reward;
      $("#game-over").classList.remove("hidden");
      refreshProfile();loadLeaderboard();
    });
    socket.on("disconnect",reason=>{
      if(reason!=="io client disconnect")showToast("Bağlantı koptu. Yeniden bağlanılıyor…");
    });
    socket.on("connect",()=>{
      if(socket.__arenaJoined&&state.room&&state.snapshot) {
        socket.emit("join",{mode:state.mode,room:state.room},ack=>{
          if(ack?.error)showToast(ack.error);
          else socket.__arenaJoined=true;
        });
      }
    });
  }
  const canvas=$("#game-canvas"),ctx=canvas.getContext("2d");
  function resizeCanvas() {
    const ratio=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.floor(innerWidth*ratio);canvas.height=Math.floor(innerHeight*ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);drawGame();
  }
  function drawGame() {
    const snapshot=state.snapshot;
    if(!snapshot||$("#game-view").classList.contains("hidden"))return;
    const width=innerWidth,height=innerHeight;
    const me=state.me||snapshot.snakes[0];
    if(!me)return;
    const cx=me.x,cy=me.y;
    ctx.clearRect(0,0,width,height);
    ctx.fillStyle="#10131c";ctx.fillRect(0,0,width,height);
    ctx.save();ctx.translate(width/2-cx,height/2-cy);
    const grid=70;ctx.strokeStyle="rgba(157,170,205,.075)";ctx.lineWidth=1;
    const left=cx-width/2,top=cy-height/2;
    for(let x=Math.floor(left/grid)*grid;x<left+width+grid;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+height);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<top+height+grid;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+width,y);ctx.stroke();}
    ctx.strokeStyle="#ff758d";ctx.lineWidth=8;ctx.strokeRect(0,0,state.world.width,state.world.height);
    for(const pellet of snapshot.food) {
      if(Math.abs(pellet.x-cx)>width*.6||Math.abs(pellet.y-cy)>height*.6)continue;
      ctx.beginPath();ctx.fillStyle=pellet.color;ctx.shadowColor=pellet.color;ctx.shadowBlur=10;ctx.arc(pellet.x,pellet.y,4,0,Math.PI*2);ctx.fill();
    }
    ctx.shadowBlur=0;
    for(const snake of snapshot.snakes) {
      const skin=state.skins.find(item=>item.id===snake.skin);
      const color=snake.color||skin?.color||"#56e0bd";
      for(let i=snake.body.length-1;i>=0;i--) {
        const part=snake.body[i],radius=Math.max(6,12-i*.015);
        ctx.beginPath();ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=i===0?13:5;ctx.arc(part.x,part.y,radius,0,Math.PI*2);ctx.fill();
      }
      ctx.shadowBlur=0;
      const head=snake.body[0];
      ctx.fillStyle="#121725";ctx.beginPath();ctx.arc(head.x+Math.cos(snake.angle+.45)*5,head.y+Math.sin(snake.angle+.45)*5,2.4,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(head.x+Math.cos(snake.angle-.45)*5,head.y+Math.sin(snake.angle-.45)*5,2.4,0,Math.PI*2);ctx.fill();
      ctx.font="600 11px DM Sans";ctx.textAlign="center";ctx.fillStyle="#f2f1f7";ctx.shadowColor="#111";ctx.shadowBlur=4;ctx.fillText(snake.username,head.x,head.y-22);ctx.shadowBlur=0;
    }
    ctx.restore();
  }
  function sendPointer(event) {
    const rect=canvas.getBoundingClientRect();
    state.pointer={x:event.clientX-rect.left,y:event.clientY-rect.top};
  }
  function sendInput() {
    const socket=state.socket,me=state.me;
    if(!socket?.connected||!me||$("#game-view").classList.contains("hidden")||!$("#game-over").classList.contains("hidden"))return;
    let angle=me.angle;
    if(state.pointer) {
      const rect=canvas.getBoundingClientRect();
      const dx=state.pointer.x-rect.width/2,dy=state.pointer.y-rect.height/2;
      if(Math.hypot(dx,dy)>8) {
        const desired=Math.atan2(dy,dx);
        const delta=Math.atan2(Math.sin(desired-me.angle),Math.cos(desired-me.angle));
        const sensitivity=0.45+state.sensitivity/10*1.1;
        angle=me.angle+Math.max(-sensitivity,Math.min(sensitivity,delta));
      }
    }
    socket.emit("input",{angle,boost:state.boosting});
  }
  async function shareLink(room) {
    const url=new URL(location.href);
    if(room)url.searchParams.set("room",room);
    else url.searchParams.delete("room");
    try { await navigator.clipboard.writeText(url.toString());showToast(room?"Davet bağlantısı kopyalandı!":"Bağlantı kopyalandı."); }
    catch { showToast(url.toString()); }
  }

  document.querySelectorAll(".mode-button").forEach(button=>button.addEventListener("click",()=>setMode(button.dataset.mode)));
  $("#play-form").addEventListener("submit",event=>{event.preventDefault();startGame();});
  $("#jump-to-play").addEventListener("click",()=>$("#username").focus());
  $("#shop-open-footer").addEventListener("click",()=>showView("shop-view"));
  $("#history-open").addEventListener("click",openHistory);
  document.querySelectorAll("[data-back]").forEach(button=>button.addEventListener("click",()=>showView("menu-view")));
  $("#profile-avatar").addEventListener("click",()=>$("#settings-modal").classList.remove("hidden"));
  $("#game-admin-open").addEventListener("click",()=>$("#settings-modal").classList.remove("hidden"));
  $("#settings-close").addEventListener("click",()=>$("#settings-modal").classList.add("hidden"));
  $("#player-reset-submit").addEventListener("click",resetPlayerScores);
  $("#sound-toggle").addEventListener("click",()=>{
    state.sound=!state.sound;localStorage.setItem("arena-sound",state.sound?"on":"off");
    $("#sound-toggle").classList.toggle("muted",!state.sound);showToast(state.sound?"Ses açık":"Ses kapalı");
  });
  $("#settings-sound").addEventListener("change",event=>{
    state.sound=event.target.checked;localStorage.setItem("arena-sound",state.sound?"on":"off");
    $("#sound-toggle").classList.toggle("muted",!state.sound);
  });
  $("#sensitivity").value=String(state.sensitivity);
  $("#sensitivity").addEventListener("input",event=>{
    state.sensitivity=Number(event.target.value);
    localStorage.setItem("arena-sensitivity",String(state.sensitivity));
  });
  $("#copy-room").addEventListener("click",()=>shareLink($("#room-code").value.trim().toUpperCase()||null));
  $("#share-room").addEventListener("click",()=>shareLink(state.room));
  $("#leave-game").addEventListener("click",()=>{
    state.socket?.emit("leave");
    state.socket?.disconnect();state.socket=null;state.snapshot=null;state.me=null;
    showView("menu-view");refreshProfile();
  });
  $("#return-menu").addEventListener("click",()=>{
    state.socket?.emit("leave");state.socket?.disconnect();state.socket=null;state.snapshot=null;state.me=null;
    $("#game-over").classList.add("hidden");showView("menu-view");refreshProfile();
  });
  $("#play-again").addEventListener("click",()=>startGame(state.mode));
  canvas.addEventListener("pointermove",sendPointer);
  canvas.addEventListener("pointerdown",event=>{
    if(event.pointerType==="touch")event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    state.boosting=true;sendPointer(event);sendInput();
  });
  const releaseBoost=()=>{if(state.boosting){state.boosting=false;sendInput();}};
  canvas.addEventListener("pointerup",releaseBoost);
  canvas.addEventListener("pointercancel",releaseBoost);
  canvas.addEventListener("lostpointercapture",releaseBoost);
  window.addEventListener("pointerup",releaseBoost);
  window.addEventListener("blur",releaseBoost);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)releaseBoost();});
  window.addEventListener("keydown",event=>{
    if(event.code==="Space"&&!event.repeat){event.preventDefault();state.boosting=true;sendInput();}
  });
  window.addEventListener("keyup",event=>{if(event.code==="Space"){event.preventDefault();releaseBoost();}});
  window.addEventListener("resize",resizeCanvas);
  const roomFromLink=new URLSearchParams(location.search).get("room");
  if(roomFromLink){setMode("online");$("#room-code").value=roomFromLink;}
  $("#settings-sound").checked=state.sound;
  $("#sound-toggle").classList.toggle("muted",!state.sound);
  resizeCanvas();
  setInterval(sendInput,25);
  refreshProfile();
  loadLeaderboard();
  setInterval(loadLeaderboard,20000);
  window.addEventListener("beforeunload",()=>state.socket?.disconnect());
})();
