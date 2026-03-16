"use strict";(()=>{var h={high:"\uB192\uC74C",medium:"\uBCF4\uD1B5",low:"\uB0AE\uC74C"},y={confirmed:"\uD655\uC815",suspicious:"\uC758\uC2EC"},C={dom:"DOM",nlp:"NLP",network:"\uB124\uD2B8\uC6CC\uD06C"};function s(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function b(e){return e<=30?{label:"\uC548\uC804",cls:"verdict-safe",fillCls:"fill-safe"}:e<=60?{label:"\uC8FC\uC758",cls:"verdict-caution",fillCls:"fill-caution"}:{label:"\uC704\uD5D8",cls:"verdict-danger",fillCls:"fill-danger"}}function v(){let e=document.createElement("div");return e.className="state-view",e.innerHTML=`
    <span class="state-icon">\u23F3</span>
    <span class="state-title">\uC544\uC9C1 \uC2A4\uCE94 \uC804\uC785\uB2C8\uB2E4</span>
    <span class="state-desc">\uD398\uC774\uC9C0\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uBA74<br>\uC790\uB3D9\uC73C\uB85C \uC2A4\uCE94\uC774 \uC2DC\uC791\uB429\uB2C8\uB2E4.</span>
  `,e}function $(e){let t=document.createElement("div");t.className="state-view";let n=new Date(e.scanTimestamp).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});return t.innerHTML=`
    <span class="state-icon">\u2705</span>
    <span class="state-title">\uB2E4\uD06C \uD328\uD134\uC774 \uD0D0\uC9C0\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4</span>
    <span class="state-desc">\uC2A4\uCE94 \uC2DC\uAC01: ${s(n)}</span>
  `,t}function E(e){let{overallRiskScore:t,detections:n}=e,{label:c,cls:i,fillCls:r}=b(t),a=new Date(e.scanTimestamp).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}),o=n.filter(d=>d.severity==="high").length,u=n.filter(d=>d.severity==="medium").length,g=n.filter(d=>d.confidence==="confirmed").length,l=[];o&&l.push(`\uB192\uC74C ${o}\uAC74`),u&&l.push(`\uBCF4\uD1B5 ${u}\uAC74`);let p=n.length-o-u;p>0&&l.push(`\uB0AE\uC74C ${p}\uAC74`);let f=l.length?l.join(" \xB7 ")+` (\uD655\uC815 ${g}\uAC74)`:"",m=document.createElement("div");return m.className="score-section",m.innerHTML=`
    <div class="score-row">
      <span class="score-label">\uC704\uD5D8\uB3C4</span>
      <span class="score-number" style="color: var(--text)">${t}</span>
      <span class="score-unit">/ 100</span>
      <span class="score-verdict ${s(i)}">${s(c)}</span>
    </div>
    <div class="score-bar-track">
      <div class="score-bar-fill ${s(r)}" id="score-fill"></div>
    </div>
    <div class="score-summary">
      \uD0D0\uC9C0 ${n.length}\uAC74${f?" \xB7 "+s(f):""} &middot; \uC2A4\uCE94 ${s(a)}
    </div>
  `,m}function L(e){let t=document.createElement("div");return t.className="detection-card",t.innerHTML=`
    <div class="card-bar bar-${s(e.severity)}"></div>
    <div class="card-body">
      <div class="card-top">
        <span class="guideline-num">\uAE30\uC900 ${e.guideline}</span>
        <span class="card-name">${s(e.guidelineName)}</span>
      </div>
      <div class="chips">
        <span class="chip chip-${s(e.confidence)}">${s(y[e.confidence])}</span>
        <span class="chip chip-${s(e.severity)}">\uC2EC\uAC01\uB3C4 ${s(h[e.severity])}</span>
      </div>
      <div class="card-desc">${s(e.description)}</div>
      <div class="card-meta">${s(C[e.module]??e.module)} \uBAA8\uB4C8</div>
    </div>
  `,t}function D(e){let t=document.createDocumentFragment();t.appendChild(E(e));let n=document.createElement("div");n.className="list-header",n.textContent=`\uD0D0\uC9C0 \uD56D\uBAA9 ${e.detections.length}\uAC74`,t.appendChild(n);let c=[...e.detections].sort((i,r)=>{let a={high:2,medium:1,low:0},o={confirmed:1,suspicious:0};return a[r.severity]-a[i.severity]||o[r.confidence]-o[i.confidence]});for(let i of c)t.appendChild(L(i));return t.appendChild(w(e)),t}function R(e){let t=JSON.stringify(e,null,2),n=new Blob([t],{type:"application/json"}),c=URL.createObjectURL(n),i=new Date(e.scanTimestamp).toISOString().replace(/[:.]/g,"-").slice(0,19),r="";try{r=new URL(e.pageUrl).hostname+"-"}catch{}let a=document.createElement("a");a.href=c,a.download=`dark-scanner-${r}${i}.json`,a.click(),URL.revokeObjectURL(c)}function w(e){let t=document.createElement("div");t.className="export-row";let n=document.createElement("button");return n.className="export-btn",n.textContent="\uACB0\uACFC \uB0B4\uBCF4\uB0B4\uAE30 (JSON)",n.addEventListener("click",()=>R(e)),t.appendChild(n),t}function T(e){let t=document.getElementById("score-fill");t&&requestAnimationFrame(()=>{requestAnimationFrame(()=>{t.style.width=`${e}%`})})}document.addEventListener("DOMContentLoaded",async()=>{let e=document.getElementById("root"),t;try{let[c]=await chrome.tabs.query({active:!0,currentWindow:!0});t=c?.id}catch{}if(t===void 0){e.innerHTML="",e.appendChild(v());return}let n=null;try{let c=`result:${t}`;n=(await chrome.storage.session.get(c))[c]??null}catch{}if(e.innerHTML="",!n){e.appendChild(v());return}if(n.detections.length===0){e.appendChild($(n));return}e.appendChild(D(n)),T(n.overallRiskScore)});})();
