/* Only approved public menus are saved by catalog.ts. Never reads auth or orders. */
try {
 const saved=JSON.parse(localStorage.getItem('cpugrab-public-catalog')||'null');
 if(saved?.catalog){
  const root=document.getElementById('public-menus');
  const intro=document.createElement('p');intro.textContent='Saved menus · '+new Date(saved.savedAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})+'. Availability and prices may have changed.';root.append(intro);
  for(const stall of saved.catalog.stalls){
   const section=document.createElement('section');const title=document.createElement('h2');title.textContent=stall.name;section.append(title);
   for(const item of saved.catalog.items.filter(i=>i.stall_id===stall.id)){
    const row=document.createElement('p');row.textContent=item.name+' · '+new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(item.price_centavos/100)+(item.is_available?'':' · Unavailable at last update');section.append(row);
   }
   root.append(section);
  }
 }
}catch{/* Corrupt or blocked storage does not prevent the offline fallback. */}
