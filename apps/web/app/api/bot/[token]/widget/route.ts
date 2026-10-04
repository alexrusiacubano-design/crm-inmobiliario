/**
 * Script para insertar el asistente en cualquier sitio:
 * <script src="https://<crm>/api/bot/<token>/widget" async></script>
 * Agrega un botón flotante que abre el chat en un iframe.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{48}$/.test(token)) return new Response("// asistente no encontrado", { status: 404 });
  const origin = new URL(request.url).origin;
  const src = `${origin}/chat/${token}`;
  const js = `(function(){if(window.__crmBot)return;window.__crmBot=1;
var b=document.createElement("button");b.type="button";b.setAttribute("aria-label","Abrir chat");
b.style.cssText="position:fixed;right:20px;bottom:20px;z-index:2147483646;width:56px;height:56px;border-radius:50%;border:0;background:#0f766e;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;font-size:26px;line-height:56px";
b.textContent="\\u{1F4AC}";
var f=null;b.onclick=function(){if(!f){f=document.createElement("iframe");f.src=${JSON.stringify(src)};f.title="Chat";
f.style.cssText="position:fixed;right:20px;bottom:88px;z-index:2147483647;width:min(380px,calc(100vw - 40px));height:min(600px,calc(100vh - 120px));border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);background:#fff";
document.body.appendChild(f);}else{f.style.display=f.style.display==="none"?"block":"none";}};
document.body.appendChild(b);})();`;
  return new Response(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
