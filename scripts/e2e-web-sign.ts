import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";
import { homedir } from "node:os"; import { join } from "node:path";
const db = new PrismaClient();
(async()=>{
 const i = await db.inbound.findFirstOrThrow({where:{number:7109}});
 const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
 const p = await ctx.newPage(); const errs:string[]=[];
 p.on("console",m=>m.type()==="error"&&errs.push(m.text().slice(0,150)));
 await p.goto(`https://dockclerk.vercel.app/driver/${i.driverToken}`,{waitUntil:"networkidle"});
 const S = join(homedir(),"dockclerk-e2e","2026-10-31-web-fotos");
 await p.screenshot({path:join(S,"driver-03-sign-start.png"),fullPage:true});
 await p.getByPlaceholder("Your name").fill("Conductor Prueba"); const c = p.locator("canvas").first(); const bb = await c.boundingBox();
 if(!bb){console.log("NO CANVAS");}
 else { await p.mouse.move(bb.x+20,bb.y+30); await p.mouse.down(); for(let k=0;k<20;k++) await p.mouse.move(bb.x+20+k*8,bb.y+30+(k%2)*30); await p.mouse.up();
  const t=Date.now(); await p.getByRole("button",{name:/Sign the receipt/i}).click();
  await p.getByText(/signed|thank/i).first().waitFor({timeout:60000}).catch(()=>console.log("no signed text"));
  console.log("sign took",(Date.now()-t)/1000); }
 await p.waitForTimeout(1500);
 await p.screenshot({path:join(S,"driver-04-signed.png"),fullPage:true});
 console.log((await p.locator("body").innerText()).replace(/\s+/g," ").slice(0,500));
 console.log("scrollW",await p.evaluate(()=>document.documentElement.scrollWidth),"errors",errs);
 await b.close(); await db.$disconnect();
})();
