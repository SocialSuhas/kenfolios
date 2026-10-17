// Scope: /community-staging/* ONLY. Never intercept /community/.
const denied = () => new Response('Staging is private. Open the preview from KenFolios Cockpit.', {status:403,headers:{'cache-control':'no-store','x-robots-tag':'noindex'}});
const bytes = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function valid(ticket,secret) {
  if(!ticket || !secret) return false;
  const parts=ticket.split('.');
  if(parts.length!==2) return false;
  let payload;
  try { payload=JSON.parse(new TextDecoder().decode(bytes(parts[0]))); }catch{return false;}
  if(payload.scope!=='community-staging' || !Number.isFinite(payload.exp) || payload.exp<Date.now() || payload.exp>Date.now()+300000) return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,bytes(parts[1]),new TextEncoder().encode(parts[0])).catch(()=>false);
}
export async function onRequest(context) {
  const {request,env}=context;
  const url=new URL(request.url);
  const ticket=url.searchParams.get('preview_token') || (request.headers.get('cookie')||'').match(/(?:^|;\s*)kf_staging_preview=([^;]+)/)?.[1];
  if(!(await valid(ticket,env.STAGING_PREVIEW_SECRET))) return denied();
  if(url.searchParams.has('preview_token')){
    url.searchParams.delete('preview_token');
    const headers=new Headers({'location':url.pathname+url.search,'cache-control':'no-store','set-cookie':`kf_staging_preview=${ticket}; Path=/community-staging/; Max-Age=300; Secure; HttpOnly; SameSite=Lax`,'x-robots-tag':'noindex'});
    return new Response(null,{status:302,headers});
  }
  const response=await context.next();
  const headers=new Headers(response.headers);
  headers.set('cache-control','private, no-store');
  headers.set('x-robots-tag','noindex');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
