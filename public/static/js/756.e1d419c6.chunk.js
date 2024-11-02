"use strict";(self.webpackChunkwhatsapp_clone_yt=self.webpackChunkwhatsapp_clone_yt||[]).push([[756],{8756:(e,t,a)=>{a.d(t,{ReactPhotoEditor:()=>d});var r,s=a(5043),l={exports:{}},n={};l.exports=function(){if(r)return n;r=1;var e=s,t=Symbol.for("react.element"),a=Symbol.for("react.fragment"),l=Object.prototype.hasOwnProperty,o=e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,i={key:!0,ref:!0,__self:!0,__source:!0};function d(e,a,r){var s,n={},d=null,c=null;for(s in void 0!==r&&(d=""+r),void 0!==a.key&&(d=""+a.key),void 0!==a.ref&&(c=a.ref),a)l.call(a,s)&&!i.hasOwnProperty(s)&&(n[s]=a[s]);if(e&&e.defaultProps)for(s in a=e.defaultProps)void 0===n[s]&&(n[s]=a[s]);return{$$typeof:t,type:e,key:d,ref:c,props:n,_owner:o.current}}return n.Fragment=a,n.jsx=d,n.jsxs=d,n}();var o=l.exports;const i="text-gray-900 bg-white border border-gray-300 ml-2 focus:outline-none hover:bg-gray-100 focus:ring-4 focus:ring-gray-100 font-medium rounded-full text-sm px-2 py-1 dark:bg-gray-800 dark:text-white dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:border-gray-600 dark:focus:ring-gray-700",d=e=>{let{file:t,onSaveImage:a,allowColorEditing:r=!0,allowFlip:l=!0,allowRotate:n=!0,allowZoom:d=!0,downloadOnSave:c,open:u,onClose:h}=e;const m=(0,s.useRef)(null),[x,g]=(0,s.useState)(""),[p,b]=(0,s.useState)(""),[f,y]=(0,s.useState)(100),[v,w]=(0,s.useState)(100),[k,j]=(0,s.useState)(100),[N,L]=(0,s.useState)(0),[C,S]=(0,s.useState)(0),[_,I]=(0,s.useState)(!1),[R,M]=(0,s.useState)(!1),[O,U]=(0,s.useState)(1),[E,z]=(0,s.useState)(!1),[F,P]=(0,s.useState)(null),[V,$]=(0,s.useState)(0),[B,W]=(0,s.useState)(0),H=()=>{z(!1)};(0,s.useEffect)((()=>{if(t){const e=URL.createObjectURL(t);return g(e),b(t.name),()=>{URL.revokeObjectURL(e)}}}),[t,u]),(0,s.useEffect)((()=>{Z()}),[t,x,C,_,R,O,f,v,k,N,V,B]);const Z=()=>{const e=m.current,t=null==e?void 0:e.getContext("2d"),a=new Image;a.src=x,a.onload=()=>{if(e&&t){const r=a.width*O,s=a.height*O,l=(a.width-r)/2,n=(a.height-s)/2;if(e.width=a.width,e.height=a.height,t.filter=D(),t.save(),C){const a=e.width/2,r=e.height/2;t.translate(a,r),t.rotate(C*Math.PI/180),t.translate(-a,-r)}_&&(t.translate(e.width,0),t.scale(-1,1)),R&&(t.translate(0,e.height),t.scale(1,-1)),t.translate(l,n),t.translate(V,B),t.scale(O,O),t.drawImage(a,0,0,e.width,e.height),t.restore()}}},D=()=>`brightness(${f}%) contrast(${v}%) grayscale(${N}%) saturate(${k}%)`,Y=(e,t,a,r)=>{var s;const l=parseInt(null==(s=e.target)?void 0:s.value);!isNaN(l)&&l>=a&&l<=r&&t(l)},T=()=>{U((e=>e+.1))},X=()=>{U((e=>Math.max(e-.1,.1)))},A=[{name:"rotate",value:C,setValue:S,min:-180,max:180,type:"range",id:"rotateInput","aria-labelledby":"rotateInputLabel",hide:!n},{name:"brightness",value:f,setValue:y,min:0,max:200,type:"range",id:"brightnessInput","aria-labelledby":"brightnessInputLabel",hide:!r},{name:"contrast",value:v,setValue:w,min:0,max:200,type:"range",id:"contrastInput","aria-labelledby":"contrastInputLabel",hide:!r},{name:"saturate",value:k,setValue:j,min:0,max:200,type:"range",id:"saturateInput","aria-labelledby":"saturateInputLabel",hide:!r},{name:"grayscale",value:N,setValue:L,min:0,max:100,type:"range",id:"grayscaleInput","aria-labelledby":"grayscaleInputLabel",hide:!r}],q=()=>{y(100),w(100),j(100),L(0),S(0),I(!1),M(!1),U(1),$(0),W(0),P(null),z(!1)};return o.jsx(o.Fragment,{children:u&&o.jsxs(o.Fragment,{children:[o.jsx("div",{"data-testid":"photo-editor-main",className:"photo-editor-main justify-center items-center flex overflow-auto fixed inset-0 z-50",children:o.jsxs("div",{className:"relative rounded-lg shadow-lg w-[40rem] max-sm:w-[22rem] bg-white h-[38rem] dark:bg-[#1e1e1e]",children:[o.jsxs("div",{className:"flex justify-end p-2 rounded-t",children:[o.jsx("button",{className:i,onClick:()=>{q(),h&&h()},children:"Close"}),o.jsx("button",{className:i,onClick:()=>(()=>{const e=m.current;e&&e.toBlob((e=>{if(e){const t=new File([e],p,{type:e.type});if(c){const t=URL.createObjectURL(e),a=document.createElement("a");a.download=`${p}`,a.href=t,a.click(),URL.revokeObjectURL(t)}a(t),h&&h()}q()}))})(),"data-testid":"save-button",children:"Save"})]}),o.jsx("div",{className:"p-2",children:o.jsxs("div",{className:"flex flex-col",children:[o.jsx("canvas",{className:"canvas border dark:border-gray-700 max-w-xl max-h-[22rem] w-full object-fit mx-auto "+(E?"cursor-grabbing":"cursor-grab"),"data-testid":"image-editor-canvas",id:"canvas",ref:m,onPointerDown:e=>{z(!0);const t=e.clientX-(_?-V:V),a=e.clientY-(R?-B:B);P({x:t,y:a})},onPointerMove:e=>{if(E){e.preventDefault();const t=e.clientX-F.x,a=e.clientY-F.y;$(_?-t:t),W(R?-a:a)}},onPointerUp:H,onPointerLeave:H,onWheel:e=>{e.deltaY<0?T():X()}}),o.jsx("div",{className:"items-center flex m-1 flex-col",children:o.jsx("div",{className:"flex flex-col bottom-12 gap-1 mt-4 max-sm:w-72 w-11/12 absolute ",children:A.map((e=>!e.hide&&o.jsxs("div",{className:"flex flex-row items-center",children:[o.jsxs("label",{id:`${e.name}InputLabel`,className:"text-xs font-medium text-gray-900 dark:text-white w-10",children:[e.name[0].toUpperCase()+e.name.slice(1),":"," "]}),o.jsx("input",{id:e.id,"aria-labelledby":e["aria-labelledby"],type:e.type,value:e.value,step:"1",onChange:t=>Y(t,e.setValue,e.min,e.max),min:e.min,max:e.max,className:"ml-[1.7rem] w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer range-sm dark:bg-gray-700"}),o.jsx("input",{type:"number","aria-labelledby":e["aria-labelledby"],value:e.value,onChange:t=>Y(t,e.setValue,e.min,e.max),min:e.min,max:e.max,className:"w-14 ml-2 rounded-md text-right bg-gray-100 text-black dark:bg-gray-700 dark:text-white"})]},e.name)))})}),o.jsx("div",{className:"flex justify-center",children:o.jsxs("div",{className:"mb-1 absolute bottom-0 mt-2",children:[o.jsx("button",{title:"Reset photo",className:"mx-1 focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-700 rounded-md p-1",onClick:q,"aria-label":"Reset photo",children:o.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:"lucide lucide-rotate-ccw dark:stroke-slate-200",children:[o.jsx("path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}),o.jsx("path",{d:"M3 3v5h5"})]})}),l&&o.jsxs("div",{className:"inline-block","data-testid":"flip-btns",children:[o.jsx("button",{className:"mx-1 focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-700 rounded-md p-1",onClick:()=>I(!_),title:"Flip photo horizontally","aria-label":"Flip photo horizontally",children:o.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:"lucide lucide-flip-horizontal dark:stroke-slate-200",children:[o.jsx("path",{d:"M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"}),o.jsx("path",{d:"M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"}),o.jsx("path",{d:"M12 20v2"}),o.jsx("path",{d:"M12 14v2"}),o.jsx("path",{d:"M12 8v2"}),o.jsx("path",{d:"M12 2v2"})]})}),o.jsx("button",{className:"mx-1 focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-700 rounded-md p-1",onClick:()=>M(!R),title:"Flip photo vertically","aria-label":"Flip photo vertically",children:o.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:"lucide lucide-flip-vertical dark:stroke-slate-200",children:[o.jsx("path",{d:"M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"}),o.jsx("path",{d:"M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"}),o.jsx("path",{d:"M4 12H2"}),o.jsx("path",{d:"M10 12H8"}),o.jsx("path",{d:"M16 12h-2"}),o.jsx("path",{d:"M22 12h-2"})]})})]}),d&&o.jsxs("div",{className:"inline-block","data-testid":"zoom-btns",children:[o.jsx("button",{"data-testid":"zoom-in",className:"mx-1 focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-700 rounded-md p-1",onClick:T,title:"Zoom in","aria-label":"Zoom in",children:o.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:"lucide lucide-zoom-in dark:stroke-slate-200",children:[o.jsx("circle",{cx:"11",cy:"11",r:"8"}),o.jsx("line",{x1:"21",x2:"16.65",y1:"21",y2:"16.65"}),o.jsx("line",{x1:"11",x2:"11",y1:"8",y2:"14"}),o.jsx("line",{x1:"8",x2:"14",y1:"11",y2:"11"})]})}),o.jsx("button",{"data-testid":"zoom-out",className:"mx-1 focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-700 rounded-md p-1",onClick:X,title:"Zoom out","aria-label":"Zoom out",children:o.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:"lucide lucide-zoom-out dark:stroke-slate-200",children:[o.jsx("circle",{cx:"11",cy:"11",r:"8"}),o.jsx("line",{x1:"21",x2:"16.65",y1:"21",y2:"16.65"}),o.jsx("line",{x1:"8",x2:"14",y1:"11",y2:"11"})]})})]})]})})]})})]})}),o.jsx("div",{className:"opacity-75 fixed inset-0 z-40 bg-black"})]})})}}}]);
//# sourceMappingURL=756.e1d419c6.chunk.js.map