"use strict";(()=>{var a=`
  .highlight {
    position: fixed;
    box-sizing: border-box;
    pointer-events: none;
    border-radius: 2px;
  }
  .highlight.severity-high   { border: 2px solid #ef4444; }
  .highlight.severity-medium { border: 2px solid #f97316; }
  .highlight.severity-low    { border: 2px solid #eab308; }
  .highlight.confidence-suspicious { border-style: dashed; }
  .highlight.confidence-confirmed  { border-style: solid;  }

  /* \uBC30\uC9C0 \uD638\uBC84 \uC2DC \uD574\uB2F9 \uD558\uC774\uB77C\uC774\uD2B8\uB97C \uC804\uBA74\uC73C\uB85C */
  .highlight:has(.badge:hover) { z-index: 2147483640; }

  /* \u2500\u2500 \uBC30\uC9C0 (\uC88C\uC0C1\uB2E8 \uACE0\uC815) \u2500\u2500 */
  .badge {
    position: absolute;
    top: -1px;
    left: -1px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 6px 1px 4px;
    border-radius: 0 0 4px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.6;
    color: #fff;
    pointer-events: auto;   /* \uD638\uBC84 \uAC10\uC9C0 */
    cursor: help;
    white-space: nowrap;
    user-select: none;
  }
  .badge.severity-high   { background: #ef4444; }
  .badge.severity-medium { background: #f97316; }
  .badge.severity-low    { background: #ca8a04; }

  /* \u2500\u2500 \uD234\uD301 (\uBC30\uC9C0 \uD638\uBC84 \uC2DC \uD45C\uC2DC) \u2500\u2500 */
  .tooltip {
    display: none;
    position: absolute;
    left: 0;
    min-width: 230px;
    max-width: 300px;
    background: #1e1e2e;
    color: #cdd6f4;
    border-radius: 8px;
    padding: 10px 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 12px;
    line-height: 1.55;
    box-shadow: 0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
    z-index: 1;
    pointer-events: none;
    word-break: keep-all;
    white-space: normal;
  }
  .badge:hover .tooltip { display: block; }

  .tooltip-title {
    font-size: 13px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 6px;
    white-space: nowrap;
  }
  .tooltip-chips {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .chip {
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.6;
  }
  .chip-confirmed  { background: #a6e3a1; color: #1e1e2e; }
  .chip-suspicious { background: #f9e2af; color: #1e1e2e; }
  .chip-high   { background: #f38ba8; color: #1e1e2e; }
  .chip-medium { background: #fab387; color: #1e1e2e; }
  .chip-low    { background: #f9e2af; color: #1e1e2e; }

  .tooltip-desc {
    color: #bac2de;
    font-size: 11px;
    line-height: 1.6;
  }
  .tooltip-meta {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid #313244;
    font-size: 10px;
    color: #585b70;
  }
  .tooltip-disclaimer {
    margin-top: 4px;
    font-size: 9px;
    color: #45475a;
  }
`,p={high:"\uB192\uC74C",medium:"\uBCF4\uD1B5",low:"\uB0AE\uC74C"},d={dom:"DOM",nlp:"NLP",network:"\uB124\uD2B8\uC6CC\uD06C"};function l(n){return n.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function c(n){try{return document.evaluate(n,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue}catch{return null}}var r=class{root;entries=[];rafPending=!1;constructor(){let e=document.createElement("dark-scanner-overlay");Object.assign(e.style,{position:"fixed",top:"0",left:"0",width:"0",height:"0",overflow:"visible",zIndex:"2147483646",pointerEvents:"none"}),this.root=e.attachShadow({mode:"closed"});let t=document.createElement("style");t.textContent=a,this.root.appendChild(t),document.documentElement.appendChild(e),this.bindRepositionListeners()}render(e){for(let{el:t}of this.entries)t.remove();this.entries=[];for(let t of e){if(!t.element?.xpath)continue;let o=this.buildHighlight(t);this.root.appendChild(o),this.entries.push({xpath:t.element.xpath,el:o})}this.repositionAll()}buildHighlight(e){let t=document.createElement("div");t.className=`highlight severity-${e.severity} confidence-${e.confidence}`;let o=document.createElement("div");o.className=`badge severity-${e.severity}`,o.textContent=`\u26A0 \uAE30\uC900${e.guideline}`;let i=document.createElement("div");return i.className="tooltip",i.innerHTML=`
      <div class="tooltip-title">${l(e.guidelineName)}</div>
      <div class="tooltip-chips">
        <span class="chip chip-${e.confidence}">${e.confidence==="confirmed"?"\uD655\uC815":"\uC758\uC2EC"}</span>
        <span class="chip chip-${e.severity}">\uC2EC\uAC01\uB3C4 ${p[e.severity]??e.severity}</span>
      </div>
      <div class="tooltip-desc">${l(e.description)}</div>
      <div class="tooltip-meta">\uACF5\uC815\uC704 \uAE30\uC900 ${e.guideline}\uBC88 \xB7 ${d[e.module]??e.module} \uBAA8\uB4C8</div>
      <div class="tooltip-disclaimer">\uACF5\uC815\uC704 \uAE30\uC900 \uAE30\uBC18 \uC790\uB3D9 \uBD84\uC11D \uACB0\uACFC\uC785\uB2C8\uB2E4.</div>
    `,o.appendChild(i),t.appendChild(o),t}repositionAll(){for(let{xpath:e,el:t}of this.entries){let o=c(e);if(!o){t.style.display="none";continue}let i=o.getBoundingClientRect();if(i.width===0&&i.height===0){t.style.display="none";continue}t.style.top=`${i.top}px`,t.style.left=`${i.left}px`,t.style.width=`${i.width}px`,t.style.height=`${i.height}px`,t.style.display="";let s=t.querySelector(".tooltip");s&&(window.innerHeight-i.bottom<170&&i.top>170?(s.style.top="",s.style.bottom="calc(100% + 6px)"):(s.style.top="calc(100% + 6px)",s.style.bottom=""))}}scheduleReposition(){this.rafPending||(this.rafPending=!0,requestAnimationFrame(()=>{this.rafPending=!1,this.repositionAll()}))}bindRepositionListeners(){window.addEventListener("scroll",()=>this.scheduleReposition(),{passive:!0,capture:!0}),window.addEventListener("resize",()=>this.scheduleReposition(),{passive:!0})}};if(!document.querySelector("dark-scanner-overlay")){let n=new r;chrome.runtime.onMessage.addListener(e=>{e.type==="SCAN_COMPLETE"&&n.render(e.payload.detections)})}})();
