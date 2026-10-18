// Temporary HTTP Basic Authentication for /community-staging/* only.
// Credentials live in Cloudflare Pages encrypted environment variables.
const unauthorized=()=>new Response("Authentication required",{status:401,headers:{"WWW-Authenticate":'Basic realm="KenFolios Staging", charset="UTF-8"',"cache-control":"no-store","x-robots-tag":"noindex, nofollow"}});
async function equals(a,b){const enc=new TextEncoder();const x=await crypto.subtle.digest("SHA-256",enc.encode(a));const y=await crypto.subtle.digest("SHA-256",enc.encode(b));return [...new Uint8Array(x)].every((v,i)=>v===new Uint8Array(y)[i]);}
export async function onRequest({request,env,next}){
  if(!env.STAGING_BASIC_USER||!env.STAGING_BASIC_PASSWORD)return new Response("Staging authentication is not configured",{status:503,headers:{"cache-control":"no-store"}});
  const auth=request.headers.get("authorization")||"";
  if(!auth.startsWith("Basic "))return unauthorized();
  let decoded;
  try{decoded=atob(auth.slice(6));}catch{return unauthorized();}
  const colon=decoded.indexOf(":");
  if(colon<0)return unauthorized();
  const validUser=await equals(decoded.slice(0,colon),env.STAGING_BASIC_USER);
  const validPassword=await equals(decoded.slice(colon+1),env.STAGING_BASIC_PASSWORD);
  if(!validUser||!validPassword)return unauthorized();
  const response=await next();
  const headers=new Headers(response.headers);
  headers.set("cache-control","private, no-store");
  headers.set("x-robots-tag","noindex, nofollow");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
